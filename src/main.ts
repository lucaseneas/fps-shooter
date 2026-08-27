import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Room } from "colyseus.js";

import { createScene, applyBoxMap, setMatchAtmosphere } from "./scene/createScene";
import { FpsController } from "./player/FpsController";
import { ViewModel } from "./player/ViewModel";
import { PlayerVisual } from "./player/PlayerVisual";
import { WeaponSystem } from "./game/WeaponSystem";
import { EffectsManager } from "./game/effects";
import { HelicopterVisual } from "./game/HelicopterVisual";
import { ParachuteVisual } from "./game/ParachuteVisual";
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
  buyShopItem,
  clearStoredToken,
  fetchAuthStatus,
  fetchCustomWeaponSkins,
  fetchProfile,
  loginAccount,
  publishWeaponSkin,
  deleteWeaponSkin,
  registerAccount,
  restoreSession,
  saveAccountPrefs,
  syncAccountInventory,
  SESSION_REPLACED_LEAVE_CODE,
} from "./net/authApi";
import { Minimap } from "./ui/Minimap";
import { SocialPanel } from "./ui/Social";
import {
  PresencePayload,
  isSocialConnected,
  sendPresence,
} from "./net/socialClient";
import { CONFIG, GAME_MODES, KILLS_TO_WIN_OPTIONS, MAPS, TEAMS, gameModeLabel, isTdmMode, isZombiesMode } from "../shared/config";
import { ZOMBIES_MAX_PLAYERS, zombieMaxHealth } from "../shared/zombies";
import {
  DEFAULT_LOADOUT,
  LoadoutSlots,
  WEAPONS,
  WeaponCategory,
  WeaponDef,
  WeaponId,
  getWeapon,
  isMeleeWeapon,
  isStreakWeapon,
  resolveWeaponId,
  weaponMoveSpeedMult,
  weaponsForCategory,
} from "../shared/weapons";
import {
  WeaponSkinDef,
  allWeaponSkins,
  encodeWeaponSkinParts,
  getWeaponSkin,
  registerCustomWeaponSkins,
  sanitizeWeaponSkin,
  decodeWeaponSkinLooks,
  unregisterCustomWeaponSkin,
  weaponSkinsFor,
} from "../shared/weaponSkins";
import { WeaponSkinStudio, hexToRgb, rgbToHex } from "./ui/WeaponSkinStudio";
import { TexturePicker } from "./ui/TexturePicker";
import { MapStudio } from "./ui/MapStudio";
import { getCustomMap, playableMapOptions, refreshCustomMaps } from "./ui/mapStorage";
import {
  customMapToGeometry,
  sanitizeCustomMap,
} from "../shared/customMap";
import {
  getActiveMap,
  resetActiveMap,
  setActiveMapGeometry,
} from "../shared/mapRuntime";
import { AppRoute, navigate, onRouteChange } from "./app/router";
import {
  MAX_XP,
  XP_RULES,
  rankForXp,
  rankIconUrl,
  rankProgress,
} from "../shared/ranks";
import { GOLD_RULES, MAX_GOLD } from "../shared/gold";
import {
  KILL_STREAK_REWARDS,
  PREDATOR,
  isPredatorStreak,
  killStreakRewardForKey,
} from "../shared/killStreaks";
import { SKINS } from "../shared/skins";
import {
  PlayerInventory,
  ShopItemDef,
  defaultInventory,
  getShopItems,
  ownsItem,
  sanitizeInventory,
  withItem,
} from "../shared/inventory";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const pageLogin = document.getElementById("pageLogin") as HTMLDivElement;
const pageHome = document.getElementById("pageHome") as HTMLDivElement;
const pageMaps = document.getElementById("pageMaps") as HTMLDivElement;
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
const appBoot = document.getElementById("appBoot") as HTMLDivElement;
const bootStatus = document.getElementById("bootStatus") as HTMLParagraphElement;
const settingsButton = document.getElementById("settingsButton") as HTMLButtonElement;
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
const settingsLobbyTab = document.getElementById("settingsLobbyTab") as HTMLButtonElement;
const settingsGameplayPanel = document.getElementById(
  "settingsGameplayPanel"
) as HTMLDivElement;
const settingsLobbyPanel = document.getElementById("settingsLobbyPanel") as HTMLDivElement;
const settingsDeveloperPanel = document.getElementById(
  "settingsDeveloperPanel"
) as HTMLDivElement;
const volSlider = document.getElementById("volSlider") as HTMLInputElement;
const volValue = document.getElementById("volValue") as HTMLSpanElement;
const crosshairEl = document.getElementById("crosshair") as HTMLDivElement;
const reticlePreview = document.getElementById("reticlePreview") as HTMLDivElement;
const reticleStyles = document.getElementById("reticleStyles") as HTMLDivElement;
const reticleSizeSlider = document.getElementById("reticleSizeSlider") as HTMLInputElement;
const reticleSizeValue = document.getElementById("reticleSizeValue") as HTMLSpanElement;
const reticleCenterRow = document.getElementById("reticleCenterRow") as HTMLDivElement;
const reticleCenterToggle = document.getElementById(
  "reticleCenterToggle"
) as HTMLInputElement;
const reticleModes = document.getElementById("reticleModes") as HTMLDivElement;
const reticleModeHint = document.getElementById("reticleModeHint") as HTMLParagraphElement;
const devInfiniteToggle = document.getElementById("devInfiniteToggle") as HTMLInputElement;
const devHitboxToggle = document.getElementById("devHitboxToggle") as HTMLInputElement;
const devTracersToggle = document.getElementById("devTracersToggle") as HTMLInputElement;
const devUnlockStreaksToggle = document.getElementById(
  "devUnlockStreaksToggle"
) as HTMLInputElement;
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
const createGameMode = document.getElementById("createGameMode") as HTMLSelectElement;
const createKillsToWin = document.getElementById("createKillsToWin") as HTMLSelectElement;
const createMap = document.getElementById("createMap") as HTMLSelectElement;
const pageLobby = document.getElementById("pageLobby") as HTMLDivElement;
const lobbyRoomName = document.getElementById("lobbyRoomName") as HTMLHeadingElement;
const lobbyStatus = document.getElementById("lobbyStatus") as HTMLParagraphElement;
const lobbyLeaveButton = document.getElementById("lobbyLeaveButton") as HTMLButtonElement;
const lobbyMapSelect = document.getElementById("lobbyMapSelect") as HTMLSelectElement;
const lobbyModeSelect = document.getElementById("lobbyModeSelect") as HTMLSelectElement;
const lobbyKillsSelect = document.getElementById("lobbyKillsSelect") as HTMLSelectElement;
const lobbyMaxPlayersSelect = document.getElementById("lobbyMaxPlayersSelect") as HTMLSelectElement;
const lobbyBotsSlider = document.getElementById("lobbyBotsSlider") as HTMLInputElement;
const lobbyBotsValue = document.getElementById("lobbyBotsValue") as HTMLSpanElement;
const lobbySettingsHint = document.getElementById("lobbySettingsHint") as HTMLParagraphElement;
const lobbyPlayersList = document.getElementById("lobbyPlayersList") as HTMLDivElement;
const lobbyPlayersCount = document.getElementById("lobbyPlayersCount") as HTMLSpanElement;
const lobbyReadyCount = document.getElementById("lobbyReadyCount") as HTMLParagraphElement;
const lobbyChatLog = document.getElementById("lobbyChatLog") as HTMLDivElement;
const lobbyChatForm = document.getElementById("lobbyChatForm") as HTMLFormElement;
const lobbyChatInput = document.getElementById("lobbyChatInput") as HTMLInputElement;
const lobbyReadyButton = document.getElementById("lobbyReadyButton") as HTMLButtonElement;
const lobbyZombieCountdown = document.getElementById("lobbyZombieCountdown") as HTMLParagraphElement;
const createBotsRow = document.getElementById("createBotsRow") as HTMLDivElement;
const createKillsRow = document.getElementById("createKillsRow") as HTMLDivElement;
const lobbyKillsRow = document.getElementById("lobbyKillsRow") as HTMLDivElement;
const lobbyBotsRow = document.getElementById("lobbyBotsRow") as HTMLDivElement;
const lobbyTeams = document.getElementById("lobbyTeams") as HTMLDivElement;
const lobbyTeamAlpha = document.getElementById("lobbyTeamAlpha") as HTMLButtonElement;
const lobbyTeamEcho = document.getElementById("lobbyTeamEcho") as HTMLButtonElement;
const lobbyTeamAlphaList = document.getElementById("lobbyTeamAlphaList") as HTMLDivElement;
const lobbyTeamEchoList = document.getElementById("lobbyTeamEchoList") as HTMLDivElement;
const lobbyTeamAlphaCount = document.getElementById("lobbyTeamAlphaCount") as HTMLSpanElement;
const lobbyTeamEchoCount = document.getElementById("lobbyTeamEchoCount") as HTMLSpanElement;
const lobbyPlayersHint = document.getElementById("lobbyPlayersHint") as HTMLParagraphElement;
const teamSwitchConfirm = document.getElementById("teamSwitchConfirm") as HTMLDivElement;
const teamSwitchConfirmText = document.getElementById("teamSwitchConfirmText") as HTMLParagraphElement;
const teamSwitchYes = document.getElementById("teamSwitchYes") as HTMLButtonElement;
const teamSwitchNo = document.getElementById("teamSwitchNo") as HTMLButtonElement;
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
const authTabLogin = document.getElementById("authTabLogin") as HTMLButtonElement;
const authTabRegister = document.getElementById("authTabRegister") as HTMLButtonElement;
const authForm = document.getElementById("authForm") as HTMLFormElement;
const authUsername = document.getElementById("authUsername") as HTMLInputElement;
const authPassword = document.getElementById("authPassword") as HTMLInputElement;
const authSubmit = document.getElementById("authSubmit") as HTMLButtonElement;
const authStatus = document.getElementById("authStatus") as HTMLParagraphElement;
const logoutButton = document.getElementById("logoutButton") as HTMLButtonElement;
const shopPreviewCanvas = document.getElementById("shopPreviewCanvas") as HTMLCanvasElement;
const shopButton = document.getElementById("shopButton") as HTMLButtonElement;
const lobbyShopButton = document.getElementById("lobbyShopButton") as HTMLButtonElement;
const shopModal = document.getElementById("shopModal") as HTMLDivElement;
const closeShopModalButton = document.getElementById("closeShopModalButton") as HTMLButtonElement;
const shopCatalog = document.getElementById("shopCatalog") as HTMLDivElement;
const shopModalGold = document.getElementById("shopModalGold") as HTMLSpanElement;
const homeProfilePreviewCanvas = document.getElementById("homeProfilePreviewCanvas") as HTMLCanvasElement;
const lobbyProfilePreviewCanvas = document.getElementById("lobbyProfilePreviewCanvas") as HTMLCanvasElement;
const lobbyOpenInventoryButton = document.getElementById("lobbyOpenInventoryButton") as HTMLButtonElement;
const openInventoryButton = document.getElementById("openInventoryButton") as HTMLButtonElement;
const inventoryModal = document.getElementById("inventoryModal") as HTMLDivElement;
const inventoryOptions = document.getElementById("inventoryOptions") as HTMLDivElement;
const inventorySkinsGrid = document.getElementById("inventorySkinsGrid") as HTMLDivElement;
const inventoryPreviewCanvas = document.getElementById("inventoryPreviewCanvas") as HTMLCanvasElement;
const inventoryModalGold = document.getElementById("inventoryModalGold") as HTMLSpanElement;
const inventoryConfirmButton = document.getElementById("inventoryConfirmButton") as HTMLButtonElement;
const inventoryCancelButton = document.getElementById("inventoryCancelButton") as HTMLButtonElement;
const inventoryWeaponsTab = document.getElementById("inventoryWeaponsTab") as HTMLDivElement;
const inventorySkinsTab = document.getElementById("inventorySkinsTab") as HTMLDivElement;
const inventoryWeaponsMain = document.getElementById("inventoryWeaponsMain") as HTMLDivElement;
const inventoryWeaponSkinPicker = document.getElementById("inventoryWeaponSkinPicker") as HTMLDivElement;
const inventoryWeaponPreviewCanvas = document.getElementById("inventoryWeaponPreviewCanvas") as HTMLCanvasElement;
const inventoryWeaponSkinList = document.getElementById("inventoryWeaponSkinList") as HTMLDivElement;
const inventoryWeaponSkinBack = document.getElementById("inventoryWeaponSkinBack") as HTMLButtonElement;

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
player.onStreakKey = (code, key) => trySendActivateStreak(code, key);
scene.activeCamera = player.camera;

const viewModel = new ViewModel(scene, player.camera);
const weapons = new WeaponSystem(
  scene,
  player.camera,
  effects,
  "self",
  () => viewModel.getMuzzleWorldPosition(),
  () => ({
    origin: player.getAimOrigin(),
    baseDir: player.getAimDirection(),
  })
);
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
let lastThirdPersonPeek = false;
let adsHiddenByOverlay = false;
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

type SettingsTab = "gameplay" | "lobby" | "developer";
let settingsTab: SettingsTab = "gameplay";

function setSettingsTab(tab: SettingsTab): void {
  if (tab === "lobby" && !isLocalHost()) tab = "gameplay";
  settingsTab = tab;
  for (const el of document.querySelectorAll<HTMLElement>("[data-settingstab]")) {
    el.classList.toggle("active", el.dataset.settingstab === tab);
  }
  settingsGameplayPanel.classList.toggle("hidden", tab !== "gameplay");
  settingsLobbyPanel.classList.toggle("hidden", tab !== "lobby");
  settingsDeveloperPanel.classList.toggle("hidden", tab !== "developer");
}

for (const el of document.querySelectorAll<HTMLElement>("[data-settingstab]")) {
  el.addEventListener("click", () =>
    setSettingsTab(el.dataset.settingstab as SettingsTab)
  );
}

function syncRoomSettingsUi(): void {
  const host = isLocalHost();
  settingsLobbyTab.classList.toggle("hidden", !host);
  if (!host && settingsTab === "lobby") setSettingsTab("gameplay");

  if (!room) {
    botsSlider.disabled = true;
    botsSettingRow.classList.remove("is-locked");
    botsHostHint.textContent = "Define quantos bots preenchem os slots vazios.";
    return;
  }

  const snap = getMatchSnapshot(room);
  const maxBots = Math.max(0, snap.maxPlayers - 1);
  botsSlider.max = String(maxBots);
  const bots = Math.min(maxBots, Math.max(0, snap.desiredBots));
  botsSlider.value = String(bots);
  botsValue.textContent = String(bots);

  botsSlider.disabled = !host;
  botsSettingRow.classList.toggle("is-locked", !host);
  botsHostHint.textContent = "Define quantos bots preenchem os slots vazios.";
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
const RETICLE_MODES = new Set(["static", "dynamic"]);
const RETICLE_MAX_GAP_PX = 26;

type ReticleStyle = "cross" | "dot" | "ring" | "chevron";
type ReticleMode = "static" | "dynamic";

interface ReticlePrefs {
  style: ReticleStyle;
  size: number;
  center: boolean;
  mode: ReticleMode;
}

const DEFAULT_RETICLE: ReticlePrefs = {
  style: "cross",
  size: 0.5,
  center: true,
  mode: "dynamic",
};

let reticlePrefs: ReticlePrefs = { ...DEFAULT_RETICLE };

function clampReticleSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETICLE.size;
  return Math.min(2, Math.max(0.5, value));
}

function loadReticlePrefs(): ReticlePrefs {
  const raw = localStorage.getItem(RETICLE_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_RETICLE };
  if (RETICLE_TYPES.has(raw)) {
    return { ...DEFAULT_RETICLE, style: raw as ReticleStyle };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReticlePrefs>;
    const style = RETICLE_TYPES.has(String(parsed.style))
      ? (parsed.style as ReticleStyle)
      : DEFAULT_RETICLE.style;
    const mode = RETICLE_MODES.has(String(parsed.mode))
      ? (parsed.mode as ReticleMode)
      : DEFAULT_RETICLE.mode;
    return {
      style,
      size: clampReticleSize(Number(parsed.size)),
      center: parsed.center !== false,
      mode,
    };
  } catch {
    return { ...DEFAULT_RETICLE };
  }
}

function baseReticleGap(size: number): number {
  return 3.2 * size;
}

function applyReticleToEl(el: HTMLElement, prefs: ReticlePrefs, gapPx: number): void {
  el.dataset.style = prefs.style;
  el.dataset.center = prefs.center ? "1" : "0";
  el.dataset.mode = prefs.mode;
  el.style.setProperty("--ch-scale", String(prefs.size));
  el.style.setProperty("--ch-gap", `${gapPx}px`);
}

function syncReticleEditor(prefs: ReticlePrefs): void {
  for (const btn of reticleStyles.querySelectorAll<HTMLButtonElement>("[data-reticle]")) {
    btn.classList.toggle("active", btn.dataset.reticle === prefs.style);
  }
  for (const btn of reticleModes.querySelectorAll<HTMLButtonElement>("[data-reticle-mode]")) {
    btn.classList.toggle("active", btn.dataset.reticleMode === prefs.mode);
  }
  reticleSizeSlider.value = String(prefs.size);
  reticleSizeValue.textContent = `${Math.round(prefs.size * 100)}%`;
  reticleCenterToggle.checked = prefs.center;
  reticleCenterRow.classList.toggle(
    "hidden",
    prefs.style === "dot" || prefs.style === "chevron"
  );
  reticleModeHint.textContent =
    prefs.mode === "dynamic"
      ? prefs.style === "dot" || prefs.style === "chevron"
        ? "Dinâmica vale para Cruz e Círculo. Ponto e chevron ficam no tamanho fixo."
        : "Abre com o spread da arma até um limite — útil para ver o cone de tiro."
      : "Fica no tamanho que você definiu, sem acompanhar o spread.";
}

function applyReticlePrefs(prefs: ReticlePrefs, persist = true): void {
  reticlePrefs = {
    style: prefs.style,
    size: clampReticleSize(prefs.size),
    center: prefs.center,
    mode: prefs.mode,
  };
  const gap = baseReticleGap(reticlePrefs.size);
  const previewGap =
    reticlePrefs.mode === "dynamic" &&
    reticlePrefs.style !== "dot" &&
    reticlePrefs.style !== "chevron"
      ? Math.min(RETICLE_MAX_GAP_PX, gap * 2.4)
      : gap;
  applyReticleToEl(crosshairEl, reticlePrefs, gap);
  applyReticleToEl(reticlePreview, reticlePrefs, previewGap);
  syncReticleEditor(reticlePrefs);
  if (persist) {
    localStorage.setItem(RETICLE_STORAGE_KEY, JSON.stringify(reticlePrefs));
  }
}

function saveReticlePatch(patch: Partial<ReticlePrefs>): void {
  applyReticlePrefs({ ...reticlePrefs, ...patch });
}

applyReticlePrefs(loadReticlePrefs(), false);

reticleStyles.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-reticle]");
  if (!btn?.dataset.reticle || !RETICLE_TYPES.has(btn.dataset.reticle)) return;
  saveReticlePatch({ style: btn.dataset.reticle as ReticleStyle });
});

reticleSizeSlider.addEventListener("input", () => {
  saveReticlePatch({ size: parseFloat(reticleSizeSlider.value) });
});

reticleCenterToggle.addEventListener("change", () => {
  saveReticlePatch({ center: reticleCenterToggle.checked });
});

reticleModes.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-reticle-mode]");
  if (!btn?.dataset.reticleMode || !RETICLE_MODES.has(btn.dataset.reticleMode)) return;
  saveReticlePatch({ mode: btn.dataset.reticleMode as ReticleMode });
});

function spreadDiameterPx(): number {
  const spreadRad = (weapons.currentSpread * Math.PI) / 180;
  const fov = player.camera.fov;
  return (canvas.clientHeight * Math.tan(spreadRad)) / Math.tan(fov / 2);
}

function updateDynamicReticle(): void {
  if (reticlePrefs.mode !== "dynamic") return;
  if (reticlePrefs.style === "dot" || reticlePrefs.style === "chevron") return;
  const base = baseReticleGap(reticlePrefs.size);
  const radius = spreadDiameterPx() / 2;
  const gap = Math.max(base, Math.min(RETICLE_MAX_GAP_PX, radius));
  crosshairEl.style.setProperty("--ch-gap", `${gap}px`);
}

const LEGACY_DEBUG_KEY = "fps.debugMode";

function loadDevSetting(key: string, legacyDefault = false): boolean {
  const stored = localStorage.getItem(key);
  if (stored !== null) return stored === "true";
  return legacyDefault;
}

const legacyDebug = localStorage.getItem(LEGACY_DEBUG_KEY) === "true";
let devInfinite = loadDevSetting("fps.dev.infinite", legacyDebug);
let devHitbox = loadDevSetting("fps.dev.hitbox", legacyDebug);
let devTracers = loadDevSetting("fps.dev.tracers", legacyDebug);
let devUnlockStreaks = loadDevSetting("fps.dev.unlockStreaks", false);

devInfiniteToggle.checked = devInfinite;
devHitboxToggle.checked = devHitbox;
devTracersToggle.checked = devTracers;
devUnlockStreaksToggle.checked = devUnlockStreaks;

function syncDevOptionsToServer(): void {
  room?.send("setDevOptions", {
    infinite: devInfinite,
    tracers: devTracers,
    unlockStreaks: devUnlockStreaks,
  });
}

function applyDevHitboxes(on: boolean): void {
  devHitbox = on;
  devHitboxToggle.checked = on;
  for (const remote of remotePlayers.values()) remote.setDebugHitboxes(on);
}

function applyDevOptions(): void {
  weapons.setInfiniteAmmo(devInfinite);
  applyDevHitboxes(devHitbox);
  hud.setDevUnlockStreaks(devUnlockStreaks);
  syncDevOptionsToServer();
  if (room && inGame) {
    const own = getOwnSnapshot(room);
    if (own) {
      hud.updateAvailableStreaks(
        streakIdsForHud(own.availableStreaks ? Array.from(own.availableStreaks) : [], own.activeStreak),
        own.activeStreak
      );
    }
  }
}

function streakIdsForHud(fromServer: string[], activeId: string): string[] {
  if (!devUnlockStreaks || activeId) return fromServer;
  return KILL_STREAK_REWARDS.map((r) => r.id);
}

function bindDevToggle(
  toggle: HTMLInputElement,
  key: string,
  apply: (on: boolean) => void
): void {
  toggle.addEventListener("change", () => {
    apply(toggle.checked);
    localStorage.setItem(key, String(toggle.checked));
    applyDevOptions();
  });
}

bindDevToggle(devInfiniteToggle, "fps.dev.infinite", (on) => {
  devInfinite = on;
});
bindDevToggle(devHitboxToggle, "fps.dev.hitbox", (on) => {
  devHitbox = on;
});
bindDevToggle(devTracersToggle, "fps.dev.tracers", (on) => {
  devTracers = on;
});
bindDevToggle(devUnlockStreaksToggle, "fps.dev.unlockStreaks", (on) => {
  devUnlockStreaks = on;
});

let room: Room | null = null;
let inGame = false;
let inLobby = false;
const remotePlayers = new Map<string, RemotePlayer>();
const ammoDropMeshes = new Map<string, Mesh>();
let reviveHolding = false;
let ownInitialized = false;
let lastKnownHealth: number = CONFIG.playerMaxHealth;
let playerDead = false;
let deathCountdown = 0;
let endScreenShown = false;
let chatTyping = false;
let loadoutPicking = false;
let loadoutPickInMatch = false;
let matchLoadoutDraft: LoadoutSlots | null = null;
let pendingMatchLoadout: LoadoutSlots | null = null;
let matchSpectating = false;
let pendingSpectateAfterDeath = false;
let awaitingSpawn = false;
let scoreboardOpen = false;
let teamSwitchOpen = false;
let freeSpectating = false;
let preSpawnKitReady = false;

/** Espectador (pré-spawn ou na partida): sem arma, sem tiro, invisível. */
function isGhostSpectating(): boolean {
  return matchSpectating || freeSpectating || player.isSpectating;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
let lastWeaponIndex = 1;
let pingMs: number | null = null;
let serverRttMs = 0;
let shopPreview: SkinPreview | null = null;
/** Dummy local visível ao segurar V (visão frontal). */
let localPlayerVisual: PlayerVisual | null = null;
let localVisualRoot: TransformNode | null = null;
let localVisualWeaponId = "";
let localVisualWeaponSkinId = "";
let localVisualSkinId = "";
let localHeli: HelicopterVisual | null = null;
let localChute: ParachuteVisual | null = null;
let localPredator = false;
let localParachute = false;
let localHeliLinger = 0;
let homePreview: SkinPreview | null = null;
let lobbyPreview: SkinPreview | null = null;
let inventoryPreview: SkinPreview | null = null;
let inventoryWeaponPreview: SkinPreview | null = null;
let inventoryLoadout: LoadoutSlots = { ...DEFAULT_LOADOUT };
let buyingItem = false;
let shopTab: "character" | "weapon" = "character";
let weaponSkinPickerWeapon: WeaponId | null = null;

let authEnabled = false;
let authMode: "login" | "register" = "login";
let session: AuthSession | null = null;
let guestAllowed = false;
let lobbyRefreshInterval = 0;

// XP e gold de convidado ficam no navegador (contas: o servidor/banco é autoridade).
const XP_STORAGE_KEY = "fps.xp";
const GOLD_STORAGE_KEY = "fps.gold";
let guestXp = 0;
let guestGold = 0;
let xpSyncSent = false;

function loadGuestXp(): number {
  const saved = parseInt(localStorage.getItem(XP_STORAGE_KEY) ?? "0", 10);
  guestXp = Number.isFinite(saved) ? Math.min(MAX_XP, Math.max(0, saved)) : 0;
  return guestXp;
}

function loadGuestGold(): number {
  const saved = parseInt(localStorage.getItem(GOLD_STORAGE_KEY) ?? "0", 10);
  guestGold = Number.isFinite(saved) ? Math.min(MAX_GOLD, Math.max(0, saved)) : 0;
  return guestGold;
}

loadGuestXp();
loadGuestGold();

function setAuthMessage(text: string, isError = false): void {
  authStatus.textContent = text;
  authStatus.classList.toggle("error", isError);
}

/** Expulsa sessão local — login da mesma conta noutro sítio ou separador. */
function handleSessionReplaced(message: string): void {
  clearStoredToken();
  session = null;
  guestAllowed = false;
  inventorySyncedForUser = null;
  socialPanel.disconnect();
  window.clearInterval(lobbyRefreshInterval);

  if (room) {
    inGame = false;
    inLobby = false;
    const r = room;
    room = null;
    cleanupMatchLocal();
    lobbyChatLog.replaceChildren();
    hideLobby();
    syncRoomSettingsUi();
    void r.leave();
  } else {
    stopProfilePreviews();
    hideLobby();
  }

  navigate("/login", true);
  setAuthMessage(message, true);
}

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Membro desde ${d.toLocaleDateString("pt-BR")}`;
}

interface ProfilePanelView {
  name: string;
  meta: string;
  kills: string;
  deaths: string;
  wins: string;
  matches: string;
  kd: string;
  winRate: string;
  gold: string;
}

/** Escreve o perfil em TODOS os painéis (home e pré-lobby usam data-pf). */
function renderProfilePanels(view: ProfilePanelView): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-pf]")) {
    const key = el.dataset.pf as keyof ProfilePanelView | undefined;
    if (key && key in view) el.textContent = view[key];
  }
}

/** Escreve a patente (insígnia + barra de XP) em todos os painéis data-rk. */
function renderRankPanels(xp: number): void {
  const progress = rankProgress(xp);
  const { rank, next } = progress;
  const total = Math.max(0, Math.floor(xp));
  for (const el of document.querySelectorAll<HTMLElement>("[data-rk]")) {
    const key = el.dataset.rk;
    if (key === "icon" && el instanceof HTMLImageElement) {
      el.src = rankIconUrl(rank);
      el.alt = rank.name;
      el.title = rank.name;
    } else if (key === "name") {
      el.textContent = rank.name;
    } else if (key === "fill") {
      el.style.width = `${Math.round(progress.ratio * 100)}%`;
    } else if (key === "text") {
      el.textContent = next
        ? `${total} XP · faltam ${next.minXp - total} para ${next.name}`
        : `${total} XP · patente máxima`;
    }
  }
}

function renderProfile(user: AuthUser): void {
  const kd = user.deaths > 0 ? user.kills / user.deaths : user.kills;
  const winRate = user.matches > 0 ? Math.round((user.wins / user.matches) * 100) : 0;
  renderProfilePanels({
    name: user.username,
    meta: formatMemberSince(user.createdAt),
    kills: String(user.kills),
    deaths: String(user.deaths),
    wins: String(user.wins),
    matches: String(user.matches),
    kd: kd.toFixed(2),
    winRate: `${winRate}%`,
    gold: String(Math.max(0, Math.floor(user.gold))),
  });
  renderRankPanels(user.xp);
}

/** Atualiza só as células de gold (usado no pré-lobby, pós-partida). */
function renderGoldPanels(gold: number): void {
  const total = String(Math.max(0, Math.floor(gold)));
  for (const el of document.querySelectorAll<HTMLElement>('[data-pf="gold"]')) {
    el.textContent = total;
  }
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

function setHudVisible(visible: boolean): void {
  hudRoot.classList.toggle("hidden", !visible);
}

function setBootStatus(message: string): void {
  bootStatus.textContent = message;
}

function finishAppBoot(): void {
  appBoot.classList.add("hidden");
}

type MenuPage = "login" | "home" | "lobby" | "maps";

/** Garante uma única página de menu visível (evita botões duplicados/sobrepostos). */
function setActivePage(page: MenuPage | null): void {
  pageLogin.classList.toggle("hidden", page !== "login");
  pageHome.classList.toggle("hidden", page !== "home");
  pageLobby.classList.toggle("hidden", page !== "lobby");
  pageMaps?.classList.toggle("hidden", page !== "maps");
}

const mapStudio = new MapStudio();
mapStudio.onBack = () => navigate("/home");

function applyClientWorldMap(): void {
  if (room) {
    const snap = getMatchSnapshot(room);
    if (snap.mapPayload) {
      try {
        const def = sanitizeCustomMap(JSON.parse(snap.mapPayload) as unknown);
        if (def) {
          const geo = customMapToGeometry(def);
          setActiveMapGeometry(geo, def.name);
          applyBoxMap(scene, geo.boxes, geo.mapSizeX, geo.mapSizeZ, {
            color: geo.groundColor,
            texture: geo.groundTexture,
          });
          minimap.rebuild(geo.boxes, geo.mapSizeX, geo.mapSizeZ);
          return;
        }
      } catch {
        /* mapa custom inválido — cai no padrão */
      }
    }
  }
  resetActiveMap();
  const active = getActiveMap();
  applyBoxMap(scene, active.boxes, active.mapSizeX, active.mapSizeZ);
  minimap.rebuild(active.boxes, active.mapSizeX, active.mapSizeZ);
}

function applyRoute(route: AppRoute): void {
  setHudVisible(route === "/play" && inGame);
  settingsButton.classList.toggle("hidden", route === "/login" || route === "/play");
  if (route !== "/maps") mapStudio.close();

  if (route === "/play") {
    if (!inGame) {
      navigate(
        inLobby ? "/lobby" : session || guestAllowed ? "/home" : "/login",
        true
      );
      return;
    }
    stopProfilePreviews();
    setActivePage(null);
    return;
  }

  if (route === "/lobby") {
    if (!room) {
      navigate(session || guestAllowed ? "/home" : "/login", true);
      return;
    }
    if (inGame) {
      navigate("/play", true);
      return;
    }
    stopProfilePreviews();
    setActivePage("lobby");
    startLobbyPreview();
    return;
  }

  if (route === "/home") {
    if (room) {
      void room.leave();
      return;
    }
    if (authEnabled && !session && !guestAllowed) {
      navigate("/login", true);
      return;
    }
    stopProfilePreviews();
    setActivePage("home");
    startHomePreview();
    void enterHome();
    return;
  }

  if (route === "/maps") {
    if (room) {
      void room.leave();
      return;
    }
    if (authEnabled && !session && !guestAllowed) {
      navigate("/login", true);
      return;
    }
    stopProfilePreviews();
    setActivePage("maps");
    mapStudio.open();
    return;
  }

  if (room) {
    void room.leave();
    return;
  }
  stopProfilePreviews();
  if (authEnabled && session) {
    navigate("/home", true);
    return;
  }
  if (!authEnabled && guestAllowed) {
    navigate("/home", true);
    return;
  }
  setActivePage("login");
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
    applyAccountPrefs(session.user);
    hydrateMapCatalog();
    if (result.sessionReplaced) {
      setAuthMessage("Seu outro login foi desconectado.");
    } else {
      setAuthMessage("");
    }
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
  inventorySyncedForUser = null;
  socialPanel.disconnect();
  window.clearInterval(lobbyRefreshInterval);
  navigate("/login");
  setAuthMessage("Sessão terminada.");
});

async function initAuth(): Promise<void> {
  // As skins custom precisam estar registradas antes de qualquer
  // sanitizeInventory sobre dados da conta (senão seriam descartadas).
  setBootStatus("A carregar catálogo…");
  await weaponSkinsReady;
  setBootStatus("A verificar sessão…");
  authEnabled = await fetchAuthStatus();
  guestPanel.classList.toggle("hidden", authEnabled);
  authForm.classList.toggle("hidden", !authEnabled);
  document.querySelector(".auth-tabs")?.classList.toggle("hidden", !authEnabled);

  if (authEnabled) {
    const restored = await restoreSession();
    if (restored.ok) {
      session = restored.session;
      applyAccountPrefs(session.user);
      hydrateMapCatalog();
    } else {
      session = null;
      if (restored.sessionReplaced) {
        setAuthMessage(
          "Você foi desconectado porque entrou em outro dispositivo.",
          true
        );
      }
    }
  } else {
    session = null;
  }
}

function playerName(): string {
  if (session) return session.user.username;
  return nameInput.value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
}

// --- Sistema Social (amigos, presença, convites) ---

/** Última presença enviada — patches a 30Hz não reenviam à toa. */
let lastPresenceSig = "";

function pushSocialPresence(): void {
  if (!isSocialConnected()) return;
  let payload: PresencePayload;
  if (room) {
    const snap = getMatchSnapshot(room);
    let humans = 0;
    forEachPlayer(room, (p) => {
      if (!p.isBot) humans++;
    });
    payload = {
      status: inGame ? "playing" : "lobby",
      roomId: room.roomId,
      roomName: snap.roomName,
      roomClients: humans,
      roomMax: snap.maxPlayers,
      matchStarted: snap.matchStarted,
      skinId: getActiveSkin(),
    };
  } else {
    payload = {
      status: "home",
      roomId: "",
      roomName: "",
      roomClients: 0,
      roomMax: 0,
      matchStarted: false,
      skinId: getActiveSkin(),
    };
  }
  const sig = JSON.stringify(payload);
  if (sig === lastPresenceSig) return;
  lastPresenceSig = sig;
  sendPresence(payload);
}

/** Entra na sala de um amigo ("Entrar na sala" / aceitar convite). */
async function joinFriendRoom(roomId: string): Promise<void> {
  if (!roomId || room?.roomId === roomId) return;
  if (room) {
    // Sair da sala atual dispara onLeave → resetToMenu → home; depois entra na nova.
    await room.leave();
  }
  await joinLobbyRoom(roomId);
}

const socialPanel = new SocialPanel({
  isLoggedIn: () => session !== null,
  onSessionReplaced: (message) => handleSessionReplaced(message),
  joinRoom: (roomId) => void joinFriendRoom(roomId),
  myRoom: () => {
    if (!room) return null;
    const snap = getMatchSnapshot(room);
    let humans = 0;
    forEachPlayer(room, (p) => {
      if (!p.isBot) humans++;
    });
    return {
      roomId: room.roomId,
      roomName: snap.roomName,
      humans,
      maxPlayers: snap.maxPlayers,
    };
  },
  onConnected: () => pushSocialPresence(),
  canShowSocialToasts: () => !inGame,
});

async function enterHome(): Promise<void> {
  window.clearInterval(lobbyRefreshInterval);
  void socialPanel.connect();
  if (session) {
    const profile = await fetchProfile();
    if (profile === "session_replaced") {
      handleSessionReplaced(
        "Você foi desconectado porque entrou em outro dispositivo."
      );
      return;
    }
    if (profile) {
      session = { ...session, user: profile };
      renderProfile(profile);
      applyAccountPrefs(profile);
    } else {
      renderProfile(session.user);
    }
  } else {
    renderProfilePanels({
      name: playerName(),
      meta: "Modo convidado",
      kills: "—",
      deaths: "—",
      wins: "—",
      matches: "—",
      kd: "—",
      winRate: "—",
      gold: String(loadGuestGold()),
    });
    renderRankPanels(loadGuestXp());
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
    const modeLabel = gameModeLabel(r.gameMode);
    const startedLabel = r.matchStarted ? " · <b class='room-live'>Em partida</b>" : "";
    const extra = isZombiesMode(r.gameMode)
      ? `${r.clients}/${r.maxClients} jogadores · Mapa: ${r.map}${startedLabel}`
      : `${r.killsToWin} kills · ${r.clients}/${r.maxClients} jogadores · ${r.bots} bots · Mapa: ${r.map}${startedLabel}`;
    info.innerHTML =
      `<b>${safeName}</b><br />` +
      `<span class="room-meta">${modeLabel} · ${extra}</span>`;

    const joinBtn = document.createElement("button");
    joinBtn.textContent = "Entrar";
    joinBtn.addEventListener("click", () => beginJoinFlow(r.roomId));

    row.append(info, joinBtn);
    roomListEl.appendChild(row);
  }
}

let pendingCreateOptions: CreateRoomOptions | null = null;

function syncCreateRoomForm(): void {
  const zombies = isZombiesMode(createGameMode.value);
  createBotsRow.classList.toggle("hidden", zombies);
  createKillsRow.classList.toggle("hidden", zombies);
  if (zombies) {
    createMaxPlayers.max = String(ZOMBIES_MAX_PLAYERS);
    if (parseInt(createMaxPlayers.value, 10) > ZOMBIES_MAX_PLAYERS) {
      createMaxPlayers.value = String(ZOMBIES_MAX_PLAYERS);
    }
    createBots.value = "0";
  } else {
    createMaxPlayers.max = String(CONFIG.roomSize);
  }
  const maxPlayers = parseInt(createMaxPlayers.value, 10);
  createMaxPlayersValue.textContent = String(maxPlayers);
  createBots.max = String(Math.max(0, maxPlayers - 1));
  const bots = zombies ? 0 : Math.min(parseInt(createBots.value, 10), maxPlayers - 1);
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
  refreshMapSelects();
  hydrateMapCatalog();
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
          createOpts ?? { roomName: "Sala", bots: 7, maxPlayers: 8, gameMode: "ffa", killsToWin: 20, mapId: MAPS[0].id }
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
  enterLobby(room);
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
createGameMode.addEventListener("change", syncCreateRoomForm);

createRoomForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const roomName = createRoomName.value.trim().slice(0, 24) || "Sala";
  const gameMode = createGameMode.value;
  const zombies = isZombiesMode(gameMode);
  const maxCap = zombies ? ZOMBIES_MAX_PLAYERS : CONFIG.roomSize;
  const maxPlayers = Math.min(
    maxCap,
    Math.max(zombies ? 1 : 2, parseInt(createMaxPlayers.value, 10) || maxCap)
  );
  const bots = zombies
    ? 0
    : Math.min(
        maxPlayers - 1,
        Math.max(0, parseInt(createBots.value, 10) || 0)
      );
  const killsToWin = parseInt(createKillsToWin.value, 10) || 20;
  const mapId = createMap.value || MAPS[0].id;
  const customMap = getCustomMap(mapId) ?? undefined;
  localStorage.setItem(BOTS_STORAGE_KEY, String(bots));
  pendingCreateOptions = {
    roomName,
    bots,
    maxPlayers,
    gameMode,
    killsToWin,
    mapId,
    customMap,
  };
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
        primary: resolveWeaponId(parsed.primary ?? "") ?? DEFAULT_LOADOUT.primary,
        secondary: resolveWeaponId(parsed.secondary ?? "") ?? DEFAULT_LOADOUT.secondary,
        melee: resolveWeaponId(parsed.melee ?? "") ?? DEFAULT_LOADOUT.melee,
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
        recon: "awp",
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
  const speedPct = Math.round(((w.moveSpeedMult ?? 1) - 1) * 100);
  const speed =
    speedPct !== 0 ? ` · ${speedPct > 0 ? "+" : ""}${speedPct}% velocidade` : "";
  if (isMeleeWeapon(w)) {
    return `Dano ${w.damageBody} · Alcance ${w.meleeRange}m${speed}`;
  }
  const rpm = Math.round(60 / w.fireInterval);
  const dmg = w.pellets > 1 ? `${w.damageBody}×${w.pellets}` : `${w.damageBody}`;
  return `Dano ${dmg} · Cadência ${rpm} · Pente ${w.magSize}${speed}`;
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

/**
 * Monta os 3 dropdowns de slot (principal/secundária/melee) num container.
 * `ownedIds` limita às armas do inventário (hoje todas são desbloqueadas).
 */
function buildWeaponSelects(
  root: HTMLElement,
  selected: LoadoutSlots,
  onSelect: (container: HTMLElement, slot: keyof LoadoutSlots, id: WeaponId) => void,
  ownedIds?: ReadonlySet<string>,
  onPickSkin?: (slot: keyof LoadoutSlots) => void
): void {
  root.innerHTML = "";

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
      if (ownedIds && !ownedIds.has(w.id)) continue;
      const option = document.createElement("button");
      option.type = "button";
      option.className = `weapon-option${w.id === current.id ? " selected" : ""}`;
      option.innerHTML = weaponOptionHtml(w, w.id === current.id);
      option.addEventListener("click", () => {
        onSelect(container, def.slot, w.id);
      });
      panel.appendChild(option);
    }

    currentBtn.addEventListener("click", () => {
      const willOpen = panel.classList.contains("hidden");
      closeWeaponSelectPanels(root);
      if (willOpen) {
        panel.classList.remove("hidden");
        container.classList.add("open");
      }
    });

    container.appendChild(label);
    if (onPickSkin) {
      const row = document.createElement("div");
      row.className = "weapon-select-row";
      const skinBtn = document.createElement("button");
      skinBtn.type = "button";
      skinBtn.className = "weapon-skin-btn";
      skinBtn.textContent = "Selecionar skin";
      skinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeWeaponSelectPanels(root);
        onPickSkin(def.slot);
      });
      row.append(currentBtn, skinBtn);
      container.appendChild(row);
    } else {
      container.appendChild(currentBtn);
    }
    container.appendChild(panel);
    root.appendChild(container);
  }
}

function closeWeaponSelectPanels(root: ParentNode): void {
  root
    .querySelectorAll(".weapon-select-panel")
    .forEach((el) => el.classList.add("hidden"));
  root
    .querySelectorAll(".weapon-select.open")
    .forEach((el) => el.classList.remove("open"));
}

/** Atualiza o dropdown após uma troca de arma (botão atual, check, fecha painel). */
function refreshWeaponSelectUI(container: HTMLElement, w: WeaponDef): void {
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

function renderLoadoutOptions(): void {
  const slots =
    loadoutPickInMatch && matchLoadoutDraft
      ? matchLoadoutDraft
      : loadoutPickInMatch
        ? pendingMatchLoadout ?? weapons.loadout
        : weapons.loadout;

  buildWeaponSelects(
    loadoutOptions,
    slots,
    (container, slot, id) => {
      if (loadoutPickInMatch) {
        matchLoadoutDraft = { ...slots, [slot]: id };
        refreshWeaponSelectUI(container, getWeapon(id)!);
        return;
      }
      applySelectedLoadout({ ...weapons.loadout, [slot]: id });
      exitAds();
      refreshWeaponSelectUI(container, getWeapon(id)!);
    },
    new Set(inventory.weapons)
  );
}

function applySelectedLoadout(slots: LoadoutSlots): void {
  weapons.applyLoadout(slots, true);
  localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(slots));
  lastWeaponIndex = 1;
  hud.setLoadoutWeapons(weapons.loadoutWeapons, weapons.weaponIndex);
  hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, weapons.isReloading);
  viewModel.setWeapon(weapons.weapon);
  applyEquippedSkinToViewModel(weapons.weapon.id);
  player.setSpeedMult(weaponMoveSpeedMult(weapons.weapon));
  syncPrefsToAccount();
}

function enterPreSpawn(): void {
  awaitingSpawn = true;
  pendingMatchLoadout = null;
  matchSpectating = false;
  pendingSpectateAfterDeath = false;
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
  applyEquippedSkinToViewModel(weapons.weapon.id);
  syncVisualToServer();
  ensureLocalPlayerVisual();
}

const LOCAL_VISUAL_ROOT_Y = 0.9;

function ensureLocalPlayerVisual(): void {
  if (localPlayerVisual) return;
  localVisualRoot = new TransformNode("localVisualRoot", scene);
  localVisualRoot.parent = player.getBody();
  localVisualRoot.position.y = LOCAL_VISUAL_ROOT_Y;
  localPlayerVisual = new PlayerVisual(scene, "local_visual", localVisualRoot);
  localVisualSkinId = getActiveSkin();
  localVisualWeaponId = weapons.weapon.id;
  localVisualWeaponSkinId = getEquippedWeaponSkinId(weapons.weapon.id) ?? "";
  localPlayerVisual.setSkin(localVisualSkinId);
  localPlayerVisual.setWeapon(localVisualWeaponId);
  localPlayerVisual.setWeaponSkin(localVisualWeaponSkinId);
  localVisualRoot.setEnabled(false);
}

function disposeLocalPlayerVisual(): void {
  localPlayerVisual?.dispose();
  localPlayerVisual = null;
  localVisualRoot = null;
  localVisualWeaponId = "";
  localVisualWeaponSkinId = "";
  localVisualSkinId = "";
}

function updateLocalPlayerVisual(dt: number): void {
  if (!localPlayerVisual || !localVisualRoot) return;

  const peeking = player.isThirdPersonPeeking && !isGhostSpectating();
  localVisualRoot.setEnabled(peeking);
  if (!peeking) return;

  const skinId = getActiveSkin();
  if (skinId !== localVisualSkinId) {
    localVisualSkinId = skinId;
    localPlayerVisual.setSkin(skinId);
  }
  const weaponId = weapons.weapon.id;
  if (weaponId !== localVisualWeaponId) {
    localVisualWeaponId = weaponId;
    localPlayerVisual.setWeapon(weaponId);
  }
  const weaponSkinId = getEquippedWeaponSkinId(weaponId) ?? "";
  if (weaponSkinId !== localVisualWeaponSkinId) {
    localVisualWeaponSkinId = weaponSkinId;
    localPlayerVisual.setWeaponSkin(weaponSkinId);
  }

  localPlayerVisual.setPose({
    isMoving: player.isMovingOnGround,
    isCrouching: player.isCrouching,
    speedRatio: player.isRunning ? 1.2 : 0.85,
    isAlive: !playerDead,
  });
  localPlayerVisual.update(dt);
}

function openLoadoutModal(inMatch: boolean): void {
  loadoutPicking = true;
  loadoutPickInMatch = inMatch || matchSpectating;
  weapons.setTrigger(false);
  settingsModal.classList.add("hidden");

  if (loadoutPickInMatch) {
    player.setMovementEnabled(false);
    player.setLookEnabled(false);
    if (player.isPointerLocked) player.releasePointerLock();
    matchLoadoutDraft = {
      ...(pendingMatchLoadout ?? weapons.loadout),
    };
    loadoutHint.textContent = matchSpectating
      ? "Escolhe as armas e Renascer para voltar · Confirmar guarda para a próxima morte."
      : "Troca as armas — Confirmar aplica na próxima morte · Renascer troca já · Espectador observa.";
    loadoutCancelButton.textContent = "Confirmar";
    loadoutCancelButton.classList.remove("hidden");
    spawnButton.textContent = "Renascer";
    spawnButton.classList.remove("hidden");
    spawnButton.disabled = false;
    spectateButton.classList.toggle("hidden", matchSpectating);
    loadoutModal.classList.remove("prespawn");
  } else if (inLobby) {
    loadoutHint.textContent =
      "Escolhe as armas. A horda começa quando a contagem acabar.";
    loadoutCancelButton.textContent = "Pronto";
    loadoutCancelButton.classList.remove("hidden");
    loadoutModal.classList.add("prespawn");
    spawnButton.classList.add("hidden");
    spectateButton.classList.add("hidden");
  } else {
    loadoutHint.textContent = freeSpectating
      ? "Escolhe as armas e Spawn para jogar · ou ESC para continuar a voar."
      : "Escolhe uma arma por slot e Spawn, ou entra só a observar. Na partida, I troca as armas.";
    loadoutCancelButton.textContent = "Cancelar";
    loadoutCancelButton.classList.toggle("hidden", !freeSpectating);
    loadoutModal.classList.add("prespawn");
    spawnButton.textContent = "Spawn";
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
  matchLoadoutDraft = null;
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

function confirmMatchLoadoutPick(): void {
  if (!loadoutPicking || !loadoutPickInMatch) return;
  if (matchLoadoutDraft) {
    pendingMatchLoadout = { ...matchLoadoutDraft };
    localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(pendingMatchLoadout));
  }
  closeLoadoutModal(true);
}

function cancelLoadoutPick(): void {
  if (!loadoutPicking) return;
  if (loadoutPickInMatch) {
    confirmMatchLoadoutPick();
    return;
  }
  if (inLobby) {
    applySelectedLoadout(savedLoadout());
    closeLoadoutModal(false);
    return;
  }
  if (freeSpectating) {
    closeLoadoutModal(true);
  }
}

function closeLoadoutModalWithoutResume(): void {
  loadoutPicking = false;
  loadoutPickInMatch = false;
  matchLoadoutDraft = null;
  loadoutModal.classList.add("hidden");
  loadoutModal.classList.remove("prespawn");
  loadoutCancelButton.classList.add("hidden");
  spawnButton.classList.add("hidden");
  spectateButton.classList.add("hidden");
}

function requestMatchRespawn(): void {
  if (!room || !loadoutPickInMatch || playerDead || endScreenShown || localPredator) return;
  const slots = matchLoadoutDraft ?? pendingMatchLoadout ?? weapons.loadout;
  applySelectedLoadout(slots);
  pendingMatchLoadout = null;
  closeLoadoutModalWithoutResume();
  player.setMovementEnabled(false);
  player.setLookEnabled(false);
  player.requestPointerLock();
  room.send("suicideRespawn");
}

function exitMatchSpectateUi(): void {
  matchSpectating = false;
  freeSpectating = false;
  pendingSpectateAfterDeath = false;
  hudRoot.classList.remove("freefly");
  spectateBanner.classList.add("hidden");
  player.exitSpectatorOverview();
}

function requestRespawnFromSpectate(): void {
  if (!room || !matchSpectating) return;
  const slots = matchLoadoutDraft ?? pendingMatchLoadout ?? savedLoadout();
  applySelectedLoadout(slots);
  pendingMatchLoadout = null;
  closeLoadoutModalWithoutResume();
  player.setMovementEnabled(false);
  player.setLookEnabled(false);
  player.requestPointerLock();
  room.send("requestSpawn");
}

function enterInMatchSpectate(): void {
  matchSpectating = true;
  freeSpectating = true;
  playerDead = false;
  deathCountdown = 0;
  pendingSpectateAfterDeath = false;
  hud.hideDeathScreen();
  hudRoot.classList.add("freefly");
  spectateBanner.classList.remove("hidden");
  viewModel.setVisible(false);
  weapons.setTrigger(false);
  weapons.setEnabled(false);
  player.setMovementEnabled(false);
  player.setLookEnabled(true);
  const feet = player.getFeet();
  player.enterFreeFlySpectator({ x: feet.x, y: feet.y + 2, z: feet.z });
  player.requestPointerLock();
}

function enterMatchSpectate(): void {
  if (!room || !loadoutPickInMatch) return;
  if (matchLoadoutDraft) {
    pendingMatchLoadout = { ...matchLoadoutDraft };
    localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(pendingMatchLoadout));
  }
  closeLoadoutModalWithoutResume();
  player.setMovementEnabled(false);
  player.setLookEnabled(false);
  player.requestPointerLock();
  room.send("suicideSpectate");
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

  player.enterFreeFlySpectator();
  player.requestPointerLock();
}

loadoutCancelButton.addEventListener("click", () => cancelLoadoutPick());
spawnButton.addEventListener("click", () => {
  if (loadoutPickInMatch) {
    if (matchSpectating) requestRespawnFromSpectate();
    else requestMatchRespawn();
    return;
  }
  requestPlayerSpawn();
});
spectateButton.addEventListener("click", () => {
  if (loadoutPickInMatch) enterMatchSpectate();
  else enterFreeSpectate();
});

// --- Inventário do jogador + Loja ---
// Modelo extensível (shared/inventory): hoje skins de personagem e armas;
// no futuro skins de arma e equipamentos entram nas mesmas listas/fluxos.
// Convidado: localStorage. Conta logada: o servidor (Postgres) é a autoridade.
const INVENTORY_STORAGE_KEY = "fps.inventory";
const LEGACY_OWNED_SKINS_KEY = "fps.ownedSkins";
const ACTIVE_SKIN_KEY = "fps.activeSkin";
const ACTIVE_WEAPON_SKINS_KEY = "fps.activeWeaponSkins";

function loadLocalInventory(): PlayerInventory {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) ?? "null");
  } catch {}
  // Migração: versões antigas guardavam apenas as skins nesta chave.
  if (!raw) {
    try {
      const legacy = JSON.parse(
        localStorage.getItem(LEGACY_OWNED_SKINS_KEY) ?? "null"
      );
      if (Array.isArray(legacy)) {
        raw = { ...defaultInventory(), characterSkins: legacy };
      }
    } catch {}
  }
  return sanitizeInventory(raw);
}

// Raw antes da 1ª sanitização — ids de skins custom ainda desconhecidos
// seriam descartados; após o fetch das skins re-sanitizamos a partir dele.
const rawInventorySnapshot = localStorage.getItem(INVENTORY_STORAGE_KEY);

let inventory: PlayerInventory = loadLocalInventory();

function saveLocalInventory(inv: PlayerInventory = inventory): void {
  localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inv));
}

// Persiste a migração e aposenta a chave antiga (já copiada acima).
saveLocalInventory();
localStorage.removeItem(LEGACY_OWNED_SKINS_KEY);

/**
 * Carrega as skins de arma custom do servidor e registra no catálogo local.
 * Deve completar antes de sanitizar inventários com skins custom —
 * initAuth aguarda esta promise.
 */
const weaponSkinsReady: Promise<void> = (async () => {
  try {
    const raw = await fetchCustomWeaponSkins();
    const defs = raw
      .map((s) => sanitizeWeaponSkin(s))
      .filter((s): s is WeaponSkinDef => s !== null);
    if (!defs.length) return;
    registerCustomWeaponSkins(defs);
    // Re-sanitiza o inventário local (agora os ids de skins são válidos).
    try {
      const rawInv = rawInventorySnapshot ? JSON.parse(rawInventorySnapshot) : null;
      inventory = sanitizeInventory(rawInv);
      saveLocalInventory(inventory);
    } catch {}
    syncAllViewModelSkins();
    refreshShopAndInventoryUi();
  } catch (err) {
    console.warn("[weapon-skins] falha ao carregar:", err);
  }
})();

function ownsCharacterSkin(skinId: string): boolean {
  return ownsItem(inventory, "character_skin", skinId);
}

function getActiveSkin(): string {
  const saved = localStorage.getItem(ACTIVE_SKIN_KEY);
  if (saved && ownsCharacterSkin(saved)) return saved;
  return "skin_default";
}

function setActiveSkin(skinId: string): void {
  localStorage.setItem(ACTIVE_SKIN_KEY, skinId);
  if (room) room.send("change_skin", skinId);
  if (shopPreview) shopPreview.setSkin(skinId);
  inventoryPreview?.setSkin(skinId);
  homePreview?.setSkin(skinId);
  lobbyPreview?.setSkin(skinId);
  pushSocialPresence();
  syncPrefsToAccount();
}

function loadEquippedWeaponSkins(): Partial<Record<WeaponId, string>> {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_WEAPON_SKINS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    return raw as Partial<Record<WeaponId, string>>;
  } catch {
    return {};
  }
}

function getEquippedWeaponSkinId(weaponId: WeaponId): string | null {
  const id = loadEquippedWeaponSkins()[weaponId];
  if (!id) return null;
  if (!ownsItem(inventory, "weapon_skin", id)) return null;
  const def = getWeaponSkin(id);
  return def && def.weaponId === weaponId ? id : null;
}

/** Skin visível para os outros jogadores (id + cores), sem exigir inventário no observador. */
function getVisualWeaponSkin(weaponId: WeaponId): {
  id: string;
  parts: Record<string, [number, number, number]> | null;
  textures: Record<string, string> | null;
} {
  const id =
    getEquippedWeaponSkinId(weaponId) ?? loadEquippedWeaponSkins()[weaponId] ?? "";
  const def = id ? getWeaponSkin(id) : undefined;
  if (!def || def.weaponId !== weaponId) return { id: "", parts: null, textures: null };
  return { id: def.id, parts: def.parts, textures: def.textures ?? null };
}

/** Informa arma + skin equipada para os outros jogadores verem. */
function syncVisualToServer(): void {
  if (!room) return;
  const weaponId = weapons.weapon.id;
  const skin = getVisualWeaponSkin(weaponId);
  room.send("sync_visual", {
    weaponId,
    weaponSkinId: skin.id,
    weaponSkinParts: encodeWeaponSkinParts(skin.parts, skin.textures),
  });
}

function setEquippedWeaponSkin(weaponId: WeaponId, skinId: string | null): void {
  const next = { ...loadEquippedWeaponSkins() };
  if (skinId) next[weaponId] = skinId;
  else delete next[weaponId];
  localStorage.setItem(ACTIVE_WEAPON_SKINS_KEY, JSON.stringify(next));
  applyEquippedSkinToViewModel(weaponId);
  syncVisualToServer();
}

function applyEquippedSkinToViewModel(weaponId: WeaponId): void {
  const id = getEquippedWeaponSkinId(weaponId);
  const skin = id ? getWeaponSkin(id) : undefined;
  viewModel.setWeaponSkin(weaponId, skin?.parts ?? null, skin?.textures ?? null);
}

function syncAllViewModelSkins(): void {
  for (const w of WEAPONS) {
    if (isStreakWeapon(w.id)) continue;
    applyEquippedSkinToViewModel(w.id);
  }
}

/** Evita reenviar prefs ao servidor enquanto aplicamos as prefs vindas da conta. */
let applyingAccountPrefs = false;

/** Migração local→conta roda uma vez por usuário logado. */
let inventorySyncedForUser: number | null = null;

/** Carrega o catálogo global de mapas (Postgres). */
function hydrateMapCatalog(): void {
  void refreshCustomMaps().then(() => {
    refreshMapSelects();
    mapStudio.reloadList();
  });
}

/** Persiste skin ativa + loadout atuais na conta (apenas autenticado). */
function syncPrefsToAccount(): void {
  if (!session || applyingAccountPrefs) return;
  void saveAccountPrefs({
    activeSkin: getActiveSkin(),
    loadout: { ...weapons.loadout },
  });
}

/** Aplica as prefs salvas na conta ao estado local (chamado após login/restore). */
function applyAccountPrefs(user: AuthUser): void {
  applyingAccountPrefs = true;
  try {
    // Captura o inventário local ANTES de a conta sobrescrevê-lo — é ele
    // que migra (skins compradas como convidado / localStorage antigo).
    const localBefore = inventory;

    // A conta é a autoridade do inventário.
    inventory = sanitizeInventory(user.inventory);
    saveLocalInventory(inventory);

    // 1ª vez por login: une o inventário local ao da conta — o servidor
    // só adiciona, nunca remove.
    if (inventorySyncedForUser !== user.id) {
      inventorySyncedForUser = user.id;
      if (
        user.activeSkin &&
        !localBefore.characterSkins.includes(user.activeSkin)
      ) {
        localBefore.characterSkins.push(user.activeSkin);
      }
      void syncAccountInventory(localBefore).then((merged) => {
        if (!merged || session?.user.id !== user.id) return;
        inventory = merged;
        session.user.inventory = merged;
        saveLocalInventory(merged);
        refreshShopAndInventoryUi();
      });
    }

    if (user.activeSkin) {
      setActiveSkin(
        ownsCharacterSkin(user.activeSkin) ? user.activeSkin : "skin_default"
      );
    }
    const lo = user.loadout;
    if (
      lo &&
      getWeapon(lo.primary) &&
      getWeapon(lo.secondary) &&
      getWeapon(lo.melee)
    ) {
      applySelectedLoadout(lo as LoadoutSlots);
    }
  } finally {
    applyingAccountPrefs = false;
  }
}

function getUserCurrentGold(): number {
  if (session) return session.user.gold;
  return loadGuestGold();
}

function deductUserGold(amount: number): boolean {
  if (amount <= 0) return true;
  if (session) {
    if (session.user.gold < amount) return false;
    session.user.gold -= amount;
    renderGoldPanels(session.user.gold);
    return true;
  }
  const current = loadGuestGold();
  if (current < amount) return false;
  const next = current - amount;
  guestGold = next;
  localStorage.setItem(GOLD_STORAGE_KEY, String(next));
  renderGoldPanels(next);
  return true;
}

// --- Loja: só lista itens que o jogador ainda NÃO possui ---

function shopItemsForTab(): ShopItemDef[] {
  const type = shopTab === "character" ? "character_skin" : "weapon_skin";
  return getShopItems().filter(
    (item) => item.type === type && !ownsItem(inventory, item.type, item.id)
  );
}

function applyShopPreviewForTab(): void {
  if (!shopPreview) return;
  if (shopTab === "character") {
    shopPreview.setMode("character");
    shopPreview.setSkin(getActiveSkin());
  } else {
    shopPreview.setMode("weapon");
    const first = shopItemsForTab()[0];
    const skin = first ? getWeaponSkin(first.id) : undefined;
    const weaponId = skin?.weaponId ?? "mp5";
    shopPreview.setWeapon(weaponId);
    shopPreview.setWeaponSkin(skin ?? null);
  }
}

function renderShopCatalog(): void {
  if (!shopCatalog) return;
  shopCatalog.innerHTML = "";
  const currentGold = getUserCurrentGold();

  if (shopModalGold) {
    shopModalGold.textContent = String(Math.max(0, Math.floor(currentGold)));
  }

  const items = shopItemsForTab();
  if (items.length === 0) {
    shopCatalog.innerHTML = `<p class="shop-empty">${
      shopTab === "character"
        ? "Você já possui todas as skins de personagem."
        : "Nenhuma skin de arma à venda agora."
    }</p>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "skin-card";

    const info = document.createElement("div");
    info.className = "skin-info";
    info.innerHTML = `<h4>${item.name}</h4><p class="skin-desc">${item.desc}</p><div class="skin-price-wrap"><span class="skin-price-label">🪙 ${item.price} Gold</span></div>`;

    const action = document.createElement("div");
    action.className = "skin-action";

    const btn = document.createElement("button");
    btn.className = "btn-buy";
    btn.innerHTML = `<span>Comprar</span> <span>(🪙 ${item.price})</span>`;
    btn.disabled = currentGold < item.price || buyingItem;
    btn.addEventListener("click", () => void buyItem(item));
    action.appendChild(btn);

    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      if (item.type === "character_skin") {
        shopPreview?.setMode("character");
        shopPreview?.setSkin(item.id);
      } else {
        const skin = getWeaponSkin(item.id);
        if (!skin) return;
        shopPreview?.setMode("weapon");
        shopPreview?.setWeapon(skin.weaponId);
        shopPreview?.setWeaponSkin(skin);
      }
    });

    card.append(info, action);
    shopCatalog.appendChild(card);
  }
}

function setShopTab(tab: "character" | "weapon"): void {
  shopTab = tab;
  for (const el of document.querySelectorAll<HTMLElement>("[data-shoptab]")) {
    el.classList.toggle("active", el.dataset.shoptab === tab);
  }
  renderShopCatalog();
  applyShopPreviewForTab();
  shopPreview?.resize();
}

for (const el of document.querySelectorAll<HTMLElement>("[data-shoptab]")) {
  el.addEventListener("click", () =>
    setShopTab(el.dataset.shoptab as "character" | "weapon")
  );
}

/** Compra: conta logada passa pelo servidor; convidado desconta local. */
async function buyItem(item: ShopItemDef): Promise<void> {
  if (buyingItem) return;
  buyingItem = true;
  renderShopCatalog();
  try {
    if (session) {
      const res = await buyShopItem(item.type, item.id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      session.user.gold = res.gold;
      inventory = res.inventory;
      saveLocalInventory(inventory);
      renderGoldPanels(res.gold);
    } else {
      if (!deductUserGold(item.price)) {
        alert("Gold insuficiente para comprar este item!");
        return;
      }
      inventory = withItem(inventory, item.type, item.id);
      saveLocalInventory(inventory);
    }
    // Skin de personagem comprada já vem equipada.
    if (item.type === "character_skin") setActiveSkin(item.id);
  } finally {
    buyingItem = false;
    refreshShopAndInventoryUi();
  }
}

function openShopModal(): void {
  if (!shopModal) return;
  stopProfilePreviews();
  shopModal.classList.remove("hidden");
  setShopTab(shopTab);
  if (shopPreview) {
    shopPreview.start();
    shopPreview.resize();
  }
}

function closeShopModal(): void {
  if (!shopModal) return;
  shopModal.classList.add("hidden");
  if (shopPreview) {
    shopPreview.stop();
  }
  resumeProfilePreviewsIfVisible();
}

/** Re-renderiza loja/inventário abertos após compra ou sync da conta. */
function refreshShopAndInventoryUi(): void {
  if (!shopModal.classList.contains("hidden")) {
    renderShopCatalog();
    applyShopPreviewForTab();
  }
  if (!inventoryModal.classList.contains("hidden")) {
    renderInventorySkins();
    renderInventoryWeapons();
    if (weaponSkinPickerWeapon) renderWeaponSkinPickerList(weaponSkinPickerWeapon);
  }
}

shopButton?.addEventListener("click", openShopModal);
lobbyShopButton?.addEventListener("click", openShopModal);
closeShopModalButton?.addEventListener("click", closeShopModal);
shopModal.addEventListener("click", (e) => {
  if (e.target === shopModal) closeShopModal();
});

// --- Preview 3D do personagem na home ---

function ensureHomePreview(): SkinPreview | null {
  if (homePreview) return homePreview;
  if (!homeProfilePreviewCanvas) return null;
  homePreview = new SkinPreview(homeProfilePreviewCanvas);
  return homePreview;
}

function schedulePreviewResize(preview: SkinPreview | null): void {
  if (!preview) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => preview.resize());
  });
}

function startHomePreview(): void {
  const p = ensureHomePreview();
  if (!p) return;
  p.setMode("loadout");
  p.setSkin(getActiveSkin());
  const primary = savedLoadout().primary;
  p.setWeapon(primary);
  const equipped = getEquippedWeaponSkinId(primary);
  p.setWeaponSkin(equipped ? getWeaponSkin(equipped) ?? null : null);
  p.start();
  schedulePreviewResize(p);
}

// O painel de perfil do pré-lobby é igual ao da home: mesmo 3D e mesmos botões.

function ensureLobbyPreview(): SkinPreview | null {
  if (lobbyPreview) return lobbyPreview;
  if (!lobbyProfilePreviewCanvas) return null;
  lobbyPreview = new SkinPreview(lobbyProfilePreviewCanvas);
  return lobbyPreview;
}

function startLobbyPreview(): void {
  const p = ensureLobbyPreview();
  if (!p) return;
  p.setMode("loadout");
  p.setSkin(getActiveSkin());
  const primary = savedLoadout().primary;
  p.setWeapon(primary);
  const equipped = getEquippedWeaponSkinId(primary);
  p.setWeaponSkin(equipped ? getWeaponSkin(equipped) ?? null : null);
  p.start();
  schedulePreviewResize(p);
}

function stopProfilePreviews(): void {
  homePreview?.stop();
  lobbyPreview?.stop();
}

/** Retoma o preview do painel de perfil da página que estiver visível. */
function resumeProfilePreviewsIfVisible(): void {
  if (!pageHome.classList.contains("hidden")) {
    startHomePreview();
  } else if (!pageLobby.classList.contains("hidden")) {
    startLobbyPreview();
  }
}

// --- Modal de Inventário (home/lobby): abas Armas + Skins ---

function ensureInventoryPreview(): SkinPreview | null {
  if (inventoryPreview) return inventoryPreview;
  if (!inventoryPreviewCanvas) return null;
  inventoryPreview = new SkinPreview(inventoryPreviewCanvas);
  return inventoryPreview;
}

function ensureInventoryWeaponPreview(): SkinPreview | null {
  if (inventoryWeaponPreview) return inventoryWeaponPreview;
  if (!inventoryWeaponPreviewCanvas) return null;
  inventoryWeaponPreview = new SkinPreview(inventoryWeaponPreviewCanvas);
  return inventoryWeaponPreview;
}

function renderWeaponSkinPickerList(weaponId: WeaponId): void {
  if (!inventoryWeaponSkinList) return;
  inventoryWeaponSkinList.innerHTML = "";
  const equipped = getEquippedWeaponSkinId(weaponId);
  const owned = weaponSkinsFor(weaponId).filter((s) =>
    ownsItem(inventory, "weapon_skin", s.id)
  );

  const addCard = (
    title: string,
    desc: string,
    isActive: boolean,
    onEquip: () => void,
    onPreview: () => void
  ) => {
    const card = document.createElement("div");
    card.className = `skin-card ${isActive ? "is-active" : ""}`;
    const info = document.createElement("div");
    info.className = "skin-info";
    info.innerHTML = `<h4>${title}</h4><p class="skin-desc">${desc}</p>`;
    const action = document.createElement("div");
    action.className = "skin-action";
    const btn = document.createElement("button");
    if (isActive) {
      btn.className = "btn-equipped";
      btn.textContent = "Equipada ✓";
    } else {
      btn.className = "btn-equip";
      btn.textContent = "Equipar";
      btn.addEventListener("click", onEquip);
    }
    action.appendChild(btn);
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      onPreview();
    });
    card.append(info, action);
    inventoryWeaponSkinList.appendChild(card);
  };

  const preview = ensureInventoryWeaponPreview();
  addCard(
    "Padrão",
    "Cores reais da arma (polímero, aço, madeira).",
    !equipped,
    () => {
      setEquippedWeaponSkin(weaponId, null);
      preview?.setWeaponSkin(null);
      renderWeaponSkinPickerList(weaponId);
    },
    () => preview?.setWeaponSkin(null)
  );

  if (owned.length === 0) {
    const empty = document.createElement("p");
    empty.className = "shop-empty";
    empty.textContent = "Você ainda não tem skins desta arma. Compra na Loja.";
    inventoryWeaponSkinList.appendChild(empty);
    return;
  }

  for (const skin of owned) {
    addCard(
      skin.name,
      `Skin para ${getWeapon(skin.weaponId)?.name ?? skin.weaponId}`,
      equipped === skin.id,
      () => {
        setEquippedWeaponSkin(weaponId, skin.id);
        preview?.setWeaponSkin(skin);
        renderWeaponSkinPickerList(weaponId);
      },
      () => preview?.setWeaponSkin(skin)
    );
  }
}

function openWeaponSkinPicker(weaponId: WeaponId): void {
  weaponSkinPickerWeapon = weaponId;
  inventoryWeaponsMain.classList.add("hidden");
  inventoryWeaponSkinPicker.classList.remove("hidden");
  const p = ensureInventoryWeaponPreview();
  if (p) {
    p.setMode("weapon");
    p.setWeapon(weaponId);
    const equipped = getEquippedWeaponSkinId(weaponId);
    p.setWeaponSkin(equipped ? getWeaponSkin(equipped) ?? null : null);
    p.start();
    p.resize();
  }
  renderWeaponSkinPickerList(weaponId);
}

function closeWeaponSkinPicker(): void {
  weaponSkinPickerWeapon = null;
  inventoryWeaponSkinPicker.classList.add("hidden");
  inventoryWeaponsMain.classList.remove("hidden");
  inventoryWeaponPreview?.stop();
}

function renderInventoryWeapons(): void {
  buildWeaponSelects(
    inventoryOptions,
    inventoryLoadout,
    (container, slot, id) => {
      inventoryLoadout = { ...inventoryLoadout, [slot]: id };
      refreshWeaponSelectUI(container, getWeapon(id)!);
    },
    new Set(inventory.weapons),
    (slot) => openWeaponSkinPicker(inventoryLoadout[slot])
  );
}

/** Aba Skins: apenas as skins que o jogador POSSUI (a loja vende o resto). */
function renderInventorySkins(): void {
  if (!inventorySkinsGrid) return;
  inventorySkinsGrid.innerHTML = "";
  const active = getActiveSkin();

  if (inventoryModalGold) {
    inventoryModalGold.textContent = String(
      Math.max(0, Math.floor(getUserCurrentGold()))
    );
  }

  for (const item of SKINS) {
    if (!ownsCharacterSkin(item.id)) continue;
    const isEquipped = active === item.id;

    const card = document.createElement("div");
    card.className = `skin-card ${isEquipped ? "is-active" : ""}`;

    const info = document.createElement("div");
    info.className = "skin-info";
    info.innerHTML = `<h4>${item.name}</h4><p class="skin-desc">${item.desc}</p>`;

    const action = document.createElement("div");
    action.className = "skin-action";

    const btn = document.createElement("button");
    if (isEquipped) {
      btn.className = "btn-equipped";
      btn.textContent = "Equipada ✓";
    } else {
      btn.className = "btn-equip";
      btn.textContent = "Equipar";
      btn.addEventListener("click", () => {
        setActiveSkin(item.id);
        renderInventorySkins();
      });
    }
    action.appendChild(btn);

    // Clique no card muda o preview 3D na hora para ver
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      inventoryPreview?.setMode("character");
      inventoryPreview?.setSkin(item.id);
    });

    card.append(info, action);
    inventorySkinsGrid.appendChild(card);
  }
}

function setInventoryTab(tab: "weapons" | "skins"): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-invtab]")) {
    el.classList.toggle("active", el.dataset.invtab === tab);
  }
  inventoryWeaponsTab.classList.toggle("hidden", tab !== "weapons");
  inventorySkinsTab.classList.toggle("hidden", tab !== "skins");
  if (tab === "weapons") {
    closeWeaponSkinPicker();
    inventoryPreview?.stop();
  } else {
    closeWeaponSkinPicker();
    const p = ensureInventoryPreview();
    if (p) {
      p.setMode("character");
      p.setSkin(getActiveSkin());
      p.start();
      p.resize();
    }
  }
}

for (const el of document.querySelectorAll<HTMLElement>("[data-invtab]")) {
  el.addEventListener("click", () =>
    setInventoryTab(el.dataset.invtab as "weapons" | "skins")
  );
}

function openInventoryModal(): void {
  stopProfilePreviews();
  inventoryLoadout = savedLoadout();
  renderInventoryWeapons();
  renderInventorySkins();
  inventoryModal.classList.remove("hidden");
  setInventoryTab("weapons");
}

function closeInventoryModal(): void {
  inventoryModal.classList.add("hidden");
  closeWeaponSkinPicker();
  inventoryPreview?.stop();
  resumeProfilePreviewsIfVisible();
}

openInventoryButton?.addEventListener("click", openInventoryModal);
lobbyOpenInventoryButton?.addEventListener("click", openInventoryModal);
inventoryCancelButton.addEventListener("click", closeInventoryModal);
inventoryConfirmButton.addEventListener("click", () => {
  // Grava o loadout — é o que o pré-spawn aplica ao entrar na partida.
  applySelectedLoadout(inventoryLoadout);
  closeInventoryModal();
});
inventoryModal.addEventListener("click", (e) => {
  if (e.target === inventoryModal) closeInventoryModal();
});
inventoryWeaponSkinBack?.addEventListener("click", closeWeaponSkinPicker);

// --- Estúdio de Skins (criação de skins de arma → loja) ---
// TODO(admin): restringir o acesso a administradores quando o papel existir.

const skinStudioModal = document.getElementById("skinStudioModal") as HTMLDivElement;
const skinStudioCanvas = document.getElementById("skinStudioCanvas") as HTMLCanvasElement;
const skinStudioWeapon = document.getElementById("skinStudioWeapon") as HTMLSelectElement;
const skinStudioPartSelect = document.getElementById("skinStudioPartSelect") as HTMLSelectElement;
const skinStudioColor = document.getElementById("skinStudioColor") as HTMLInputElement;
const skinStudioClearPart = document.getElementById("skinStudioClearPart") as HTMLButtonElement;
const skinStudioClearAll = document.getElementById("skinStudioClearAll") as HTMLButtonElement;
const skinStudioPartsCount = document.getElementById("skinStudioPartsCount") as HTMLParagraphElement;
const skinStudioName = document.getElementById("skinStudioName") as HTMLInputElement;
const skinStudioPrice = document.getElementById("skinStudioPrice") as HTMLInputElement;
const skinStudioPublished = document.getElementById("skinStudioPublished") as HTMLSelectElement;
const skinStudioNew = document.getElementById("skinStudioNew") as HTMLButtonElement;
const skinStudioDelete = document.getElementById("skinStudioDelete") as HTMLButtonElement;
const skinStudioSave = document.getElementById("skinStudioSave") as HTMLButtonElement;
const skinStudioCancel = document.getElementById("skinStudioCancel") as HTMLButtonElement;

let skinStudio: WeaponSkinStudio | null = null;
let skinStudioSaving = false;
let skinStudioTexPicker: TexturePicker | null = null;
/** Id da skin em edição (null = nova publicação). */
let skinStudioEditingId: string | null = null;
let skinStudioLoadGen = 0;

function formatStudioPartLabel(name: string): string {
  return name.replace(/^Clone of /i, "").replace(/_/g, " ");
}

function syncStudioSaveLabel(): void {
  skinStudioSave.textContent = skinStudioEditingId
    ? "Salvar alterações"
    : "Salvar e publicar";
}

function refreshStudioTexturePicker(): void {
  if (!skinStudioTexPicker || !skinStudio) return;
  const part = skinStudio.selectedPartName;
  skinStudioTexPicker.setDisabled(!part);
  skinStudioTexPicker.setValue(part ? skinStudio.getPartTexture(part) ?? "none" : "none");
}

function refreshStudioPartsCount(): void {
  const n = skinStudio?.paintedCount ?? 0;
  skinStudioPartsCount.textContent =
    n === 0
      ? "Nenhuma parte pintada."
      : `${n} parte${n > 1 ? "s" : ""} pintada${n > 1 ? "s" : ""}.`;
}

function refreshStudioPartSelect(selected?: string | null): void {
  if (!skinStudioPartSelect) return;
  const names = skinStudio?.getPartNames() ?? [];
  const current = selected ?? skinStudio?.selectedPartName ?? "";
  skinStudioPartSelect.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = names.length
    ? "Clique na arma ou escolha aqui"
    : "Carregando partes…";
  skinStudioPartSelect.appendChild(empty);
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = formatStudioPartLabel(name);
    skinStudioPartSelect.appendChild(opt);
  }
  skinStudioPartSelect.value =
    current && names.includes(current) ? current : "";
  skinStudioColor.disabled = !skinStudioPartSelect.value;
}

function bindStudioPartUi(part: string | null): void {
  if (skinStudioPartSelect) {
    const names = [...skinStudioPartSelect.options].map((o) => o.value);
    skinStudioPartSelect.value = part && names.includes(part) ? part : "";
  }
  if (part && skinStudio) {
    skinStudioColor.disabled = false;
    skinStudioColor.value = rgbToHex(skinStudio.getPartColor(part));
  } else {
    skinStudioColor.disabled = true;
  }
  refreshStudioTexturePicker();
}

function refreshStudioPublishedList(): void {
  if (!skinStudioPublished) return;
  const skins = allWeaponSkins().filter((s) => s.custom);
  const prev = skinStudioEditingId ?? skinStudioPublished.value;
  skinStudioPublished.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = skins.length === 0 ? "Nenhuma skin publicada" : "— Nova skin —";
  skinStudioPublished.appendChild(blank);
  for (const s of skins) {
    const opt = document.createElement("option");
    opt.value = s.id;
    const weaponName = getWeapon(s.weaponId)?.name ?? s.weaponId;
    opt.textContent = `${s.name} · ${weaponName} · ${s.price} Gold`;
    skinStudioPublished.appendChild(opt);
  }
  if (prev && skins.some((s) => s.id === prev)) {
    skinStudioPublished.value = prev;
  } else {
    skinStudioPublished.value = "";
  }
}

async function resetStudioNewSkin(): Promise<void> {
  skinStudioEditingId = null;
  skinStudioName.value = "";
  skinStudioPrice.value = "500";
  if (skinStudioPublished) skinStudioPublished.value = "";
  syncStudioSaveLabel();
  refreshStudioPartsCount();
  await skinStudio?.setWeapon(skinStudioWeapon.value as WeaponId);
}

async function loadStudioSkin(id: string): Promise<void> {
  const def = getWeaponSkin(id);
  if (!def || !skinStudio) return;
  const gen = ++skinStudioLoadGen;
  skinStudioEditingId = def.id;
  skinStudioName.value = def.name;
  skinStudioPrice.value = String(def.price);
  skinStudioWeapon.value = def.weaponId;
  if (skinStudioPublished) skinStudioPublished.value = def.id;
  syncStudioSaveLabel();
  await skinStudio.setWeapon(def.weaponId, {
    parts: def.parts,
    textures: def.textures,
  });
  if (gen !== skinStudioLoadGen) return;
  refreshStudioPartsCount();
  refreshStudioTexturePicker();
}

function openSkinStudio(): void {
  stopProfilePreviews();
  // Mostra o overlay ANTES de criar o engine — o canvas precisa estar visível
  // para o Babylon medir o tamanho.
  skinStudioModal.classList.remove("hidden");

  if (!skinStudio) {
    skinStudio = new WeaponSkinStudio(skinStudioCanvas);
    skinStudio.onPartSelected = (part) => {
      bindStudioPartUi(part);
    };
    skinStudio.onModelReady = () => {
      refreshStudioPartSelect();
      refreshStudioPartsCount();
      refreshStudioTexturePicker();
    };
  }
  const texRoot = document.getElementById("skinStudioTexturePicker");
  if (texRoot && !skinStudioTexPicker) {
    skinStudioTexPicker = new TexturePicker(texRoot, {
      includeNone: true,
      noneLabel: "Sem textura",
      onChange: (id) => {
        const part = skinStudio?.selectedPartName;
        if (!part || !skinStudio) return;
        skinStudio.setPartTexture(part, id);
        if (id !== "none") {
          skinStudioColor.value = rgbToHex(skinStudio.getPartColor(part));
        }
        refreshStudioPartsCount();
      },
    });
    skinStudioTexPicker.setDisabled(true);
  }
  // Popula o seletor de armas uma vez.
  if (skinStudioWeapon.options.length === 0) {
    for (const w of WEAPONS) {
      if (isStreakWeapon(w.id)) continue;
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = w.name;
      skinStudioWeapon.appendChild(opt);
    }
  }
  refreshStudioPublishedList();
  skinStudio.start();
  skinStudio.resize();
  void resetStudioNewSkin();
}

function closeSkinStudio(): void {
  skinStudioModal.classList.add("hidden");
  skinStudio?.stop();
  resumeProfilePreviewsIfVisible();
}

const createMenu = document.getElementById("createMenu");
const createMenuButton = document.getElementById("createMenuButton");
const createMenuPanel = document.getElementById("createMenuPanel");

function setCreateMenuOpen(open: boolean): void {
  if (!createMenu || !createMenuButton || !createMenuPanel) return;
  createMenu.classList.toggle("open", open);
  createMenuPanel.classList.toggle("hidden", !open);
  createMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

createMenuButton?.addEventListener("click", (e) => {
  e.stopPropagation();
  setCreateMenuOpen(!createMenu?.classList.contains("open"));
});
document.getElementById("mapStudioButton")?.addEventListener("click", () => {
  setCreateMenuOpen(false);
  navigate("/maps");
});
document.getElementById("skinStudioButton")?.addEventListener("click", () => {
  setCreateMenuOpen(false);
  openSkinStudio();
});
document.addEventListener("click", (e) => {
  if (!createMenu || createMenu.contains(e.target as Node)) return;
  setCreateMenuOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setCreateMenuOpen(false);
});
skinStudioCancel.addEventListener("click", closeSkinStudio);
skinStudioModal.addEventListener("click", (e) => {
  if (e.target === skinStudioModal) closeSkinStudio();
});

skinStudioWeapon.addEventListener("change", () => {
  refreshStudioPartsCount();
  refreshStudioTexturePicker();
  void skinStudio?.setWeapon(skinStudioWeapon.value as WeaponId);
});

skinStudioPartSelect.addEventListener("change", () => {
  const name = skinStudioPartSelect.value || null;
  skinStudio?.selectPart(name);
  bindStudioPartUi(name);
});

skinStudioPublished.addEventListener("change", () => {
  const id = skinStudioPublished.value;
  if (!id) {
    void resetStudioNewSkin();
    return;
  }
  void loadStudioSkin(id);
});

skinStudioNew.addEventListener("click", () => {
  void resetStudioNewSkin();
});

skinStudioColor.addEventListener("input", () => {
  const part = skinStudio?.selectedPartName;
  if (!part) return;
  skinStudio!.setPartColor(part, hexToRgb(skinStudioColor.value));
  refreshStudioPartsCount();
});

skinStudioClearPart.addEventListener("click", () => {
  const part = skinStudio?.selectedPartName;
  if (!part) return;
  skinStudio!.clearPart(part);
  refreshStudioPartsCount();
  refreshStudioTexturePicker();
});

skinStudioClearAll.addEventListener("click", () => {
  skinStudio?.clearAllParts();
  refreshStudioPartsCount();
  refreshStudioTexturePicker();
});

skinStudioSave.addEventListener("click", () => {
  if (skinStudioSaving || !skinStudio) return;

  const name = skinStudioName.value.trim();
  const price = Math.max(0, Math.round(Number(skinStudioPrice.value) || 0));
  const parts = skinStudio.getParts();
  const textures = skinStudio.getTextures();
  const weaponId = skinStudioWeapon.value as WeaponId;

  if (!name) {
    alert("Dê um nome para a skin.");
    return;
  }
  if (Object.keys(parts).length === 0) {
    alert("Pinte ou aplique textura em pelo menos uma parte da arma antes de salvar.");
    return;
  }

  const editingExisting = Boolean(skinStudioEditingId);
  const def = {
    id:
      skinStudioEditingId ??
      `wskin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    weaponId,
    name,
    price,
    parts,
    textures: Object.keys(textures).length > 0 ? textures : undefined,
  };

  skinStudioSaving = true;
  skinStudioSave.disabled = true;
  void (async () => {
    try {
      const res = await publishWeaponSkin(def);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      const saved = sanitizeWeaponSkin(res.skin);
      if (saved) registerCustomWeaponSkins([saved]);
      skinStudioEditingId = saved?.id ?? def.id;
      alert(
        editingExisting
          ? `Skin "${name}" atualizada na loja (${price} Gold).`
          : `Skin "${name}" publicada na loja por ${price} Gold!`
      );
      refreshStudioPublishedList();
      refreshShopAndInventoryUi();
      if (saved) skinStudioPublished.value = saved.id;
      syncStudioSaveLabel();
    } finally {
      skinStudioSaving = false;
      skinStudioSave.disabled = false;
    }
  })();
});

skinStudioDelete.addEventListener("click", () => {
  const id = skinStudioPublished.value;
  if (!id) {
    alert("Selecione uma skin publicada para excluir.");
    return;
  }
  const def = getWeaponSkin(id);
  const label = def ? `"${def.name}"` : "esta skin";
  if (!confirm(`Excluir ${label} da loja? Os jogadores deixam de poder comprá-la.`)) {
    return;
  }

  skinStudioDelete.disabled = true;
  void (async () => {
    try {
      const res = await deleteWeaponSkin(id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      unregisterCustomWeaponSkin(id);
      const equipped = loadEquippedWeaponSkins();
      let changed = false;
      const next = { ...equipped };
      for (const [weaponId, skinId] of Object.entries(next)) {
        if (skinId === id) {
          delete next[weaponId as WeaponId];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(ACTIVE_WEAPON_SKINS_KEY, JSON.stringify(next));
        syncAllViewModelSkins();
      }
      if (skinStudioEditingId === id) {
        await resetStudioNewSkin();
      }
      refreshStudioPublishedList();
      refreshShopAndInventoryUi();
    } finally {
      skinStudioDelete.disabled = false;
    }
  })();
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (
    !loadoutModal.classList.contains("hidden") &&
    !target.closest(".weapon-select")
  ) {
    closeWeaponSelectPanels(loadoutOptions);
  }
  if (
    !inventoryModal.classList.contains("hidden") &&
    !target.closest(".weapon-select")
  ) {
    closeWeaponSelectPanels(inventoryOptions);
  }
});

applySelectedLoadout(savedLoadout());

/** Entra no pré-lobby da sala (criação ou join bem-sucedidos). */
function enterLobby(r: Room): void {
  room = r;
  inLobby = true;
  inGame = false;
  window.clearInterval(lobbyRefreshInterval);
  settingsModal.classList.add("hidden");

  player.onInput = (input) => {
    if (ownInitialized && !awaitingSpawn && !isGhostSpectating()) {
      room?.send("input", input);
    }
  };
  player.onStreakKey = (code, key) => {
    trySendActivateStreak(code, key);
  };

  setupRoom(r);
  applyDevOptions();

  // Convidado: informa o XP e o gold locais para aparecerem na sala.
  xpSyncSent = false;
  if (!session) {
    r.send("syncXp", { xp: loadGuestXp() });
    r.send("syncGold", { gold: loadGuestGold() });
    xpSyncSent = true;
  }

  // Envia a skin atualmente equipada no menu
  r.send("change_skin", getActiveSkin());
  syncVisualToServer();
  pushSocialPresence();

  navigate("/lobby");
  showLobby();
  if (isZombiesMode(getMatchSnapshot(r).gameMode)) {
    openLoadoutModal(false);
  }
}

/** Servidor avisou que entramos na partida (Start do líder ou Play tardio). */
function startMatchLocal(): void {
  if (!room || inGame) return;
  inGame = true;
  inLobby = false;
  socialPanel.close();
  hideLobby();
  navigate("/play");
  audio.resume();
  applyClientWorldMap();
  const zombies = isZombiesMode(getMatchSnapshot(room).gameMode);
  setMatchAtmosphere(scene, zombies);
  syncAllViewModelSkins();
  if (zombies) {
    audio.startZombieAmbience();
    applySelectedLoadout(savedLoadout());
    awaitingSpawn = true;
    playerDead = false;
    weapons.setTrigger(false);
    weapons.setEnabled(false);
    player.setMovementEnabled(false);
    player.setLookEnabled(false);
    viewModel.setVisible(false);
    hudRoot.classList.add("prespawn");
    room.send("requestSpawn");
  } else {
    enterPreSpawn();
  }
  pushSocialPresence();
}

/**
 * Conta logada: recarrega o perfil do servidor ao voltar da partida.
 * O banco já gravou XP/gold/stats do fim da partida, mas a sessão local
 * (que a loja de skins usa em getUserCurrentGold) ficava com o saldo
 * do login — sem isso o modal de skins mostrava gold desatualizado.
 */
function refreshSessionProfile(): void {
  const token = session?.token;
  if (!token) return;
  void fetchProfile().then((profile) => {
    if (!profile || session?.token !== token) return;
    if (profile === "session_replaced") {
      handleSessionReplaced(
        "Você foi desconectado porque entrou em outro dispositivo."
      );
      return;
    }
    session = { ...session, user: profile };
    inventory = sanitizeInventory(profile.inventory);
    saveLocalInventory(inventory);
    // Loja/inventário abertos no retorno: refletem saldo e itens novos na hora.
    refreshShopAndInventoryUi();
  });
}

/** Partida encerrada: limpa o estado local de combate e volta ao pré-lobby. */
function returnToLobby(): void {
  if (!room) return;
  cleanupMatchLocal();
  inGame = false;
  inLobby = true;
  pushSocialPresence();
  navigate("/lobby");
  showLobby();
  refreshSessionProfile();
  socialPanel.flushDeferredRequests();
  if (isZombiesMode(getMatchSnapshot(room).gameMode)) {
    openLoadoutModal(false);
  }
}

function showLobby(): void {
  setActivePage("lobby");
  lastLobbySig = "";
  updateLobbyUi();
}

function hideLobby(): void {
  pageLobby.classList.add("hidden");
}

/** Limpa HUD, bonecos remotos e flags de combate — sem sair da sala. */
function cleanupMatchLocal(): void {
  ownInitialized = false;
  playerDead = false;
  endScreenShown = false;
  awaitingSpawn = false;
  preSpawnKitReady = false;
  freeSpectating = false;
  matchSpectating = false;
  pendingSpectateAfterDeath = false;
  pendingMatchLoadout = null;
  matchLoadoutDraft = null;
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
  setLocalPredator(false);
  setLocalParachute(false);
  localHeli?.dispose();
  localHeli = null;
  localChute?.dispose();
  localChute = null;
  viewModel.setVisible(true);
  viewModel.setInvincible(false);
  disposeLocalPlayerVisual();
  player.setThirdPersonPeekAllowed(false);
  lastThirdPersonPeek = false;
  hud.setInvincibleVignette(false);

  for (const rp of remotePlayers.values()) rp.dispose();
  remotePlayers.clear();
  clearAmmoDropMeshes();
  hud.hideZombieBanner();
  hud.setRevivePrompt(false);
  hud.setBossHealth(0, 0);
  audio.stopZombieAmbience();
  setMatchAtmosphere(scene, false);

  weapons.setTrigger(false);
  weapons.refillAll();
  weapons.setEnabled(true);
  player.setMovementEnabled(true);
  player.setLookEnabled(true);

  hud.hideDeathScreen();
  hud.hideEndScreen();
  hud.setHealth(CONFIG.playerMaxHealth);
  hud.setKills(0);
  hud.setScoreMode("ffa");
  hud.setTeamScores(0, 0);
  closeMatchScoreboard(false);
  hud.clearAllKillStreaks();

  settingsModal.classList.add("hidden");
  closeCreateRoomModal();
  player.exitImmersive();
}

function resetToMenu(errorMsg?: string): void {
  inGame = false;
  inLobby = false;
  room = null;
  cleanupMatchLocal();
  lobbyChatLog.replaceChildren();
  hideLobby();
  syncRoomSettingsUi();
  applyClientWorldMap();
  pushSocialPresence();

  if (errorMsg) {
    statusEl.classList.add("error");
    statusEl.textContent = errorMsg;
  }
  navigate("/home");
  socialPanel.flushDeferredRequests();
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
  // O chat é da sala: aparece no pré-lobby e dentro da partida.
  for (const log of [chatLog, lobbyChatLog]) {
    const entry = document.createElement("div");
    entry.className = "chat-entry";
    const sender = document.createElement("span");
    sender.className = "chat-name";
    sender.textContent = `${name}: `;
    entry.append(sender, document.createTextNode(text));
    log.append(entry);
    while (log.childElementCount > 100) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  }
}

settingsButton.addEventListener("click", openMenuSettings);
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

// --- Pré-lobby ---

function fillSelect(
  select: HTMLSelectElement,
  options: ReadonlyArray<{ value: string; label: string }>
): void {
  select.innerHTML = "";
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    select.appendChild(el);
  }
}

fillSelect(
  lobbyMapSelect,
  playableMapOptions()
);
fillSelect(
  createMap,
  playableMapOptions()
);

function refreshMapSelects(extra?: { value: string; label: string }): void {
  const prevCreate = createMap.value;
  const prevLobby = lobbyMapSelect.value;
  const opts = playableMapOptions();
  if (extra && !opts.some((o) => o.value === extra.value)) opts.push(extra);
  fillSelect(createMap, opts);
  fillSelect(lobbyMapSelect, opts);
  if (opts.some((o) => o.value === prevCreate)) createMap.value = prevCreate;
  if (opts.some((o) => o.value === prevLobby)) lobbyMapSelect.value = prevLobby;
}

mapStudio.setOnMapsChanged(() => refreshMapSelects());
fillSelect(
  createGameMode,
  GAME_MODES.map((m) => ({ value: m.id, label: m.label }))
);
fillSelect(
  lobbyModeSelect,
  GAME_MODES.map((m) => ({ value: m.id, label: m.label }))
);
fillSelect(
  lobbyKillsSelect,
  KILLS_TO_WIN_OPTIONS.map((k) => ({ value: String(k), label: `${k} kills` }))
);
fillSelect(
  lobbyMaxPlayersSelect,
  Array.from({ length: CONFIG.roomSize - 1 }, (_, i) => {
    const n = i + 2;
    return { value: String(n), label: `${n} jogadores` };
  })
);

function sendLobbySetting(msg: Record<string, unknown>): void {
  if (!room) return;
  room.send("updateSettings", msg);
}

lobbyMapSelect.addEventListener("change", () => {
  const mapId = lobbyMapSelect.value;
  sendLobbySetting({ mapId, customMap: getCustomMap(mapId) ?? undefined });
});
lobbyModeSelect.addEventListener("change", () =>
  sendLobbySetting({ gameMode: lobbyModeSelect.value })
);
lobbyTeamAlphaList.parentElement?.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest(".lobby-kick")) return;
  room?.send("setTeam", { team: "alpha" });
});
lobbyTeamEchoList.parentElement?.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest(".lobby-kick")) return;
  room?.send("setTeam", { team: "echo" });
});
lobbyKillsSelect.addEventListener("change", () =>
  sendLobbySetting({ killsToWin: parseInt(lobbyKillsSelect.value, 10) })
);
lobbyMaxPlayersSelect.addEventListener("change", () =>
  sendLobbySetting({ maxPlayers: parseInt(lobbyMaxPlayersSelect.value, 10) })
);
lobbyBotsSlider.addEventListener("input", () => {
  lobbyBotsValue.textContent = lobbyBotsSlider.value;
  sendLobbySetting({ bots: parseInt(lobbyBotsSlider.value, 10) });
});

lobbyReadyButton.addEventListener("click", () => {
  if (!room) return;
  const snap = getMatchSnapshot(room);
  if (snap.matchStarted) {
    room.send("playMatch");
    return;
  }
  if (snap.hostId === room.sessionId) {
    room.send("startMatch");
    return;
  }
  const me = getOwnSnapshot(room);
  room.send("setReady", { ready: !me?.ready });
});

lobbyLeaveButton.addEventListener("click", () => {
  void room?.leave();
});

function syncLobbyTeamPick(gameMode: string, ownTeam: string): void {
  const tdm = isTdmMode(gameMode);
  lobbyPlayersList.classList.toggle("hidden", tdm);
  lobbyTeams.classList.toggle("hidden", !tdm);
  lobbyTeamAlpha.classList.toggle("active", ownTeam === "alpha");
  lobbyTeamEcho.classList.toggle("active", ownTeam === "echo");
  lobbyTeamAlpha.closest(".lobby-team-col")?.classList.toggle("mine", ownTeam === "alpha");
  lobbyTeamEcho.closest(".lobby-team-col")?.classList.toggle("mine", ownTeam === "echo");
  lobbyPlayersHint.textContent = tdm
    ? "Clique na outra equipe para trocar de time. Botão direito num jogador para adicionar como amigo."
    : isZombiesMode(gameMode)
      ? "Cooperativo contra hordas. Botão direito num jogador para adicionar como amigo."
      : "Botão direito num jogador para adicionar como amigo.";
}

function currentGameMode(): string {
  return room ? getMatchSnapshot(room).gameMode : "ffa";
}

function oppositeTeam(team: string): "alpha" | "echo" {
  return team === "alpha" ? "echo" : "alpha";
}

function refreshMatchScoreboard(): void {
  if (!room || !scoreboardOpen || endScreenShown) return;
  hud.setScoreboardVisible(true, scoreboardRows(room), isTdmMode(currentGameMode()));
}

function openMatchScoreboard(): void {
  if (!room || endScreenShown || loadoutPicking) return;
  scoreboardOpen = true;
  weapons.setTrigger(false);
  player.setMovementEnabled(false);
  player.setLookEnabled(false);
  if (isGhostSpectating()) {
    weapons.setEnabled(false);
    viewModel.setVisible(false);
  }
  if (player.isPointerLocked) player.releasePointerLock();
  refreshMatchScoreboard();
}

function closeMatchScoreboard(relock: boolean): void {
  teamSwitchOpen = false;
  teamSwitchConfirm.classList.add("hidden");
  socialPanel.dismissPopovers();
  if (!scoreboardOpen) {
    if (!endScreenShown) hud.setScoreboardVisible(false);
    return;
  }
  scoreboardOpen = false;
  if (!endScreenShown) hud.setScoreboardVisible(false);
  if (awaitingSpawn) return;
  if (isGhostSpectating()) {
    weapons.setEnabled(false);
    viewModel.setVisible(false);
    player.setLookEnabled(true);
    player.setMovementEnabled(false);
    if (relock && inGame && !endScreenShown && !loadoutPicking) {
      player.requestPointerLock();
    }
    return;
  }
  player.setLookEnabled(true);
  player.setMovementEnabled(!playerDead && !endScreenShown);
  if (relock && inGame && !playerDead && !endScreenShown && !loadoutPicking) {
    player.requestPointerLock();
  }
}

function openTeamSwitchConfirm(): void {
  if (!room || !scoreboardOpen) return;
  const own = getOwnSnapshot(room);
  const next = oppositeTeam(own?.team ?? "alpha");
  const label = TEAMS[next].label;
  teamSwitchConfirmText.textContent =
    `Você vai para a ${label}. Suas kills pessoais continuam, mas só as próximas contam como ponto para o novo time.`;
  teamSwitchOpen = true;
  teamSwitchConfirm.classList.remove("hidden");
}

function closeTeamSwitchConfirm(): void {
  teamSwitchOpen = false;
  teamSwitchConfirm.classList.add("hidden");
}

function confirmTeamSwitch(): void {
  if (!room) return;
  const own = getOwnSnapshot(room);
  room.send("setTeam", { team: oppositeTeam(own?.team ?? "alpha") });
  closeTeamSwitchConfirm();
  closeMatchScoreboard(true);
}

hud.onSwitchTeam = () => openTeamSwitchConfirm();
hud.onScoreboardPlayerMenu = (target, x, y) =>
  socialPanel.openLobbyPlayerMenu(target, x, y);
teamSwitchYes.addEventListener("click", () => confirmTeamSwitch());
teamSwitchNo.addEventListener("click", () => closeTeamSwitchConfirm());

function updateNametags(r: Room, ownTeam: string): void {
  const mode = getMatchSnapshot(r).gameMode;
  const tdm = isTdmMode(mode);
  const zombies = isZombiesMode(mode);
  let aimedId = "";
  if (!awaitingSpawn && !player.isSpectating && !player.isThirdPersonPeeking) {
    const ray = player.camera.getForwardRay(90);
    const hit = scene.pickWithRay(ray, (m) => typeof m.metadata?.remoteAimId === "string");
    if (hit?.hit && hit.pickedMesh) {
      aimedId = String(hit.pickedMesh.metadata.remoteAimId);
    }
  }
  const teams = new Map<string, string>();
  const zombieIds = new Set<string>();
  forEachPlayer(r, (p, id) => {
    teams.set(id, typeof p.team === "string" ? p.team : "");
    if (p.isZombie === true) zombieIds.add(id);
  });
  for (const [id, rp] of remotePlayers) {
    const team = teams.get(id) ?? "";
    const ally = zombies
      ? !zombieIds.has(id)
      : tdm && Boolean(ownTeam && team && team === ownTeam);
    rp.setNameplateRole(ally ? "ally" : "enemy", aimedId === id);
  }
}

lobbyChatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = lobbyChatInput.value.trim();
  if (text) room?.send("chat", { text });
  lobbyChatInput.value = "";
  lobbyChatInput.focus();
});

interface LobbyPlayerRow {
  id: string;
  /** Id da conta (0 = convidado) — usado no menu de amizade. */
  userId: number;
  name: string;
  isHost: boolean;
  isSelf: boolean;
  ready: boolean;
  inMatch: boolean;
  /** XP de carreira — define a insígnia ao lado do nome. */
  xp: number;
  /** Gold total — exibido no próprio painel do pré-lobby. */
  gold: number;
  team: string;
}

function lobbyStatusChip(row: LobbyPlayerRow, matchStarted: boolean): string {
  if (row.inMatch && matchStarted)
    return `<span class="lobby-chip playing">Em partida</span>`;
  if (row.isHost) return `<span class="lobby-chip ready">Pronto</span>`;
  return row.ready
    ? `<span class="lobby-chip ready">Pronto</span>`
    : `<span class="lobby-chip waiting">Aguardando</span>`;
}

function createLobbyPlayerRow(
  row: LobbyPlayerRow,
  matchStarted: boolean,
  canKick: boolean
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `lobby-player-row${row.isSelf ? " self" : ""}`;

  const rank = rankForXp(row.xp);
  const insignia = document.createElement("img");
  insignia.className = "lobby-rank";
  insignia.src = rankIconUrl(rank);
  insignia.alt = rank.name;
  insignia.title = rank.name;

  const name = document.createElement("span");
  name.className = "lobby-player-name";
  name.textContent = row.name;

  const chips = document.createElement("span");
  chips.className = "lobby-chips";
  chips.innerHTML =
    (row.isHost ? `<span class="lobby-chip host">Líder</span>` : "") +
    lobbyStatusChip(row, matchStarted);

  el.append(insignia, name, chips);

  if (canKick && !row.isSelf) {
    const kick = document.createElement("button");
    kick.type = "button";
    kick.className = "lobby-kick";
    kick.title = "Remover da sala";
    kick.textContent = "✕";
    kick.addEventListener("click", () => {
      room?.send("kickPlayer", { playerId: row.id });
    });
    el.appendChild(kick);
  }

  if (!row.isSelf) {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      socialPanel.openLobbyPlayerMenu(
        { userId: row.userId, name: row.name },
        e.clientX,
        e.clientY
      );
    });
  }

  return el;
}

function fillLobbyTeamColumn(
  list: HTMLElement,
  rows: LobbyPlayerRow[],
  matchStarted: boolean,
  canKick: boolean
): void {
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "lobby-team-empty";
    empty.textContent = "Ninguém nesta equipe";
    list.appendChild(empty);
    return;
  }
  for (const row of rows) {
    list.appendChild(createLobbyPlayerRow(row, matchStarted, canKick));
  }
}

function renderLobbyPlayers(
  rows: LobbyPlayerRow[],
  matchStarted: boolean,
  canKick: boolean,
  tdm: boolean
): void {
  if (tdm) {
    const alpha = rows.filter((r) => r.team !== "echo");
    const echo = rows.filter((r) => r.team === "echo");
    lobbyTeamAlphaCount.textContent = String(alpha.length);
    lobbyTeamEchoCount.textContent = String(echo.length);
    fillLobbyTeamColumn(lobbyTeamAlphaList, alpha, matchStarted, canKick);
    fillLobbyTeamColumn(lobbyTeamEchoList, echo, matchStarted, canKick);
    return;
  }

  lobbyPlayersList.replaceChildren();
  for (const row of rows) {
    lobbyPlayersList.appendChild(createLobbyPlayerRow(row, matchStarted, canKick));
  }
}

/** Assinatura do último render — patches a 30Hz não devem re-renderizar à toa. */
let lastLobbySig = "";

function updateLobbyUi(): void {
  if (!room || !inLobby) return;
  const snap = getMatchSnapshot(room);
  let extraMap: { value: string; label: string } | undefined;
  if (snap.mapPayload) {
    try {
      const def = sanitizeCustomMap(JSON.parse(snap.mapPayload) as unknown);
      if (def) extraMap = { value: def.id, label: def.name };
    } catch {
      /* ignore */
    }
  }
  refreshMapSelects(extraMap);
  const myId = room.sessionId;
  const isHost = snap.hostId === myId;
  const canEdit = isHost && !snap.matchStarted;

  // O pré-lobby lista apenas jogadores reais — bots ficam de fora.
  const rows: LobbyPlayerRow[] = [];
  forEachPlayer(room, (p, id) => {
    if (p.isBot === true || p.isZombie === true) return;
    rows.push({
      id,
      userId: p.userId ?? 0,
      name: p.name,
      isHost: id === snap.hostId,
      isSelf: id === myId,
      ready: p.ready === true,
      inMatch: p.inMatch === true,
      xp: p.xp ?? 0,
      gold: p.gold ?? 0,
      team: typeof p.team === "string" ? p.team : "",
    });
  });
  rows.sort((a, b) => {
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const sig = JSON.stringify([
    snap.roomName,
    snap.matchStarted,
    snap.mapId,
    snap.gameMode,
    snap.killsToWin,
    snap.maxPlayers,
    snap.desiredBots,
    canEdit,
    Math.ceil(snap.prepTimeLeft),
    snap.zombiePhase,
    rows,
  ]);
  if (sig === lastLobbySig) return;
  lastLobbySig = sig;

  const zombies = isZombiesMode(snap.gameMode);
  lobbyRoomName.textContent = snap.roomName;
  if (zombies && !snap.matchStarted) {
    const secs = Math.max(0, Math.ceil(snap.prepTimeLeft));
    lobbyStatus.textContent = "Zombies — configure os armamentos";
    lobbyZombieCountdown.classList.remove("hidden");
    lobbyZombieCountdown.textContent =
      secs > 0 ? `Horda em ${secs}s` : "A iniciar…";
  } else {
    lobbyZombieCountdown.classList.add("hidden");
    lobbyStatus.textContent = snap.matchStarted
      ? "Partida em andamento — clique em Jogar para entrar"
      : "Pré-lobby — aguardando o líder iniciar";
  }
  lobbyStatus.classList.toggle("live", snap.matchStarted);
  lobbyKillsRow.classList.toggle("hidden", zombies);
  lobbyBotsRow.classList.toggle("hidden", zombies);

  const maxCap = zombies ? ZOMBIES_MAX_PLAYERS : CONFIG.roomSize;
  fillSelect(
    lobbyMaxPlayersSelect,
    Array.from({ length: Math.max(1, maxCap - (zombies ? 0 : 1)) }, (_, i) => {
      const n = i + (zombies ? 1 : 2);
      if (n > maxCap) return null;
      return { value: String(n), label: `${n} jogadores` };
    }).filter((o): o is { value: string; label: string } => o !== null)
  );

  // Configurações: líder edita no pré-lobby; demais só veem.
  lobbyMapSelect.value = snap.mapId;
  lobbyModeSelect.value = snap.gameMode;
  lobbyKillsSelect.value = String(snap.killsToWin);
  lobbyMaxPlayersSelect.value = String(snap.maxPlayers);
  const maxBots = Math.max(0, snap.maxPlayers - 1);
  lobbyBotsSlider.max = String(maxBots);
  lobbyBotsSlider.value = String(Math.min(maxBots, snap.desiredBots));
  lobbyBotsValue.textContent = String(Math.min(maxBots, snap.desiredBots));
  for (const el of [
    lobbyMapSelect,
    lobbyModeSelect,
    lobbyKillsSelect,
    lobbyMaxPlayersSelect,
    lobbyBotsSlider,
  ]) {
    el.disabled = !canEdit;
  }
  lobbySettingsHint.textContent = canEdit
    ? zombies
      ? "Você é o líder — a horda começa automaticamente. INICIAR pula a contagem."
      : "Você é o líder — ajuste as regras antes de iniciar."
    : snap.matchStarted
      ? "Partida em andamento — configurações bloqueadas."
      : "Apenas o líder pode alterar as configurações.";

  // Lista de jogadores: líder primeiro, depois os prontos.
  const readyCount = rows.filter((r) => r.ready || r.isHost).length;
  lobbyPlayersCount.textContent = `${rows.length}/${snap.maxPlayers}`;
  lobbyReadyCount.textContent = snap.matchStarted
    ? ""
    : `${readyCount} de ${rows.length} prontos`;

  const tdm = isTdmMode(snap.gameMode);
  renderLobbyPlayers(rows, snap.matchStarted, isHost, tdm);
  syncLobbyTeamPick(snap.gameMode, rows.find((r) => r.isSelf)?.team ?? "");

  // Ação principal: Start (líder) / Ready / Play tardio.
  lobbyReadyButton.classList.remove("ready", "play");
  if (snap.matchStarted) {
    lobbyReadyButton.textContent = "JOGAR AGORA";
    lobbyReadyButton.classList.add("play");
  } else if (isHost) {
    lobbyReadyButton.textContent = zombies ? "COMEÇAR AGORA" : "INICIAR PARTIDA";
  } else {
    const me = rows.find((r) => r.isSelf);
    if (me?.ready) {
      lobbyReadyButton.textContent = "PRONTO ✓";
      lobbyReadyButton.classList.add("ready");
    } else {
      lobbyReadyButton.textContent = "ESTOU PRONTO";
    }
  }

  // Patente e gold no painel do pré-lobby — o estado da sala é o mais
  // fresco (acabou de subir se houve partida).
  const meSnap = rows.find((r) => r.isSelf);
  renderRankPanels(meSnap?.xp ?? (session ? session.user.xp : loadGuestXp()));
  renderGoldPanels(meSnap?.gold ?? (session ? session.user.gold : loadGuestGold()));
}

chatInput.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    e.preventDefault();
    closeChat(true);
  }
});

function setupRoom(r: Room): void {
  r.onStateChange(() => {
    if (inGame) reconcile(r);
    if (inLobby) updateLobbyUi();
    pushSocialPresence();

    // Convidado: quando o servidor atualiza o XP/gold (fim de partida),
    // grava os novos totais no navegador.
    if (!session && xpSyncSent) {
      const own = getOwnSnapshot(r);
      if (own && own.xp !== guestXp) {
        guestXp = own.xp;
        localStorage.setItem(XP_STORAGE_KEY, String(guestXp));
      }
      if (own && own.gold !== guestGold) {
        guestGold = own.gold;
        localStorage.setItem(GOLD_STORAGE_KEY, String(guestGold));
      }
    }
  });

  // Início de partida (Start do líder) ou entrada tardia via Play.
  r.onMessage("matchStart", () => startMatchLocal());

  // Fim de partida: sala inteira volta ao pré-lobby.
  r.onMessage("backToLobby", () => returnToLobby());

  r.onMessage("kill", (e: {
    killerId: string;
    killerName: string;
    victimId?: string;
    victimName: string;
    weaponName: string;
  }) => {
    if (!inGame) return;
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
    if (e.victimId) audio.stopZombieVoice(e.victimId);
  });

  r.onMessage("killstreakEarned", (e: { playerName: string; streakName: string }) => {
    if (!inGame || isZombiesMode(currentGameMode())) return;
    hud.showKillstreakToast(`${e.playerName} liberou [${e.streakName}]!`);
  });

  r.onMessage("killstreakActivated", (e: { playerName: string; streakName: string }) => {
    if (!inGame || isZombiesMode(currentGameMode())) return;
    hud.showKillstreakToast(`${e.playerName} ativou [${e.streakName}]!`);
  });

  // Tentou ativar um streak enquanto outro ainda está rodando.
  r.onMessage("streakDenied", () => {
    if (!inGame) return;
    hud.showKillstreakToast("Aguarde o streak ativo terminar!");
  });

  r.onMessage("hitConfirm", (e: { headshot: boolean }) => {
    if (!inGame) return;
    hud.showHitmarker(e.headshot);
    audio.hitmarker(e.headshot);
  });

  r.onMessage("damaged", (e: { x: number; y: number; z: number }) => {
    if (!inGame) return;
    const feet = player.getFeet();
    const dx = e.x - feet.x;
    const dz = e.z - feet.z;
    const worldAngle = Math.atan2(dx, dz);
    let relative = worldAngle - player.getYaw();
    while (relative > Math.PI) relative -= Math.PI * 2;
    while (relative < -Math.PI) relative += Math.PI * 2;
    hud.showDirectionalDamage(relative);
    if (isZombiesMode(currentGameMode())) {
      audio.zombieAttack(e);
    }
  });

  r.onMessage("chat", (e: { name: string; text: string }) => {
    addChatMessage(e.name, e.text);
  });

  r.onMessage("died", (e: {
    killerName: string;
    weaponName: string;
    killerHealth?: number;
    voluntary?: string;
    downed?: boolean;
  }) => {
    if (!inGame) return;
    closeChat(false);
    weapons.setEnabled(false);
    exitAdsImmediate();
    hud.resetKillStreak();
    setLocalPredator(false);
    setLocalParachute(false);

    playerDead = true;
    deathCountdown = e.downed ? 0 : CONFIG.respawnDelay;
    player.setMovementEnabled(false);
    player.setLookEnabled(e.downed === true);
    if (endScreenShown) return;
    hud.showDeathScreen(e.killerName, e.weaponName, e.killerHealth ?? 0, e.downed === true);
    if (!e.downed) hud.updateDeathTimer(deathCountdown);
    audio.death();

    if (e.voluntary === "spectate") {
      pendingSpectateAfterDeath = true;
    }
  });

  r.onMessage("respawn", (e: { x: number; z: number; y?: number }) => {
    if (!inGame) return;
    const wasPreSpawn = awaitingSpawn;
    const wasGhost = isGhostSpectating();
    if (wasPreSpawn) {
      loadoutPicking = false;
      loadoutPickInMatch = false;
      matchLoadoutDraft = null;
      loadoutModal.classList.add("hidden");
      loadoutModal.classList.remove("prespawn");
      loadoutCancelButton.classList.add("hidden");
      exitPreSpawn();
    }

    if (wasGhost || matchSpectating || freeSpectating) {
      exitMatchSpectateUi();
    }

    if (pendingMatchLoadout) {
      applySelectedLoadout(pendingMatchLoadout);
      pendingMatchLoadout = null;
    }

    player.teleport(new Vector3(e.x, e.y ?? 0, e.z));
    ownInitialized = true;
    weapons.refillAll();
    weapons.setEnabled(true);
    player.setMovementEnabled(true);
    player.setLookEnabled(true);
    playerDead = false;
    hud.hideDeathScreen();
    viewModel.setWeapon(weapons.weapon);
    applyEquippedSkinToViewModel(weapons.weapon.id);
    viewModel.setVisible(true);
    audio.respawn();

    if (wasPreSpawn || wasGhost) {
      settingsModal.classList.add("hidden");
      player.requestPointerLock();
    }
  });

  r.onMessage("revived", (e: { x: number; z: number; y?: number }) => {
    if (!inGame) return;
    playerDead = false;
    ownInitialized = true;
    player.teleport(new Vector3(e.x, e.y ?? 0, e.z));
    weapons.setEnabled(true);
    player.setMovementEnabled(true);
    player.setLookEnabled(true);
    hud.hideDeathScreen();
    viewModel.setVisible(true);
    hud.showZombieBanner("REANIMADO", "", 2);
    if (!player.isPointerLocked) player.requestPointerLock();
  });

  r.onMessage("ammoPickup", () => {
    if (!inGame || playerDead) return;
    weapons.addMagazine();
  });

  r.onMessage("waveStart", (e: { round?: number; count?: number; boss?: boolean }) => {
    if (!inGame) return;
    const round = e.round ?? 1;
    hud.showZombieBanner(
      `ROUND ${round}`,
      e.boss ? `${e.count ?? 0} zumbis + BOSS` : `${e.count ?? 0} zumbis`,
      3.5
    );
  });

  r.onMessage("waveClear", (e: { round?: number }) => {
    if (!inGame) return;
    audio.stopAllZombieVoices();
    hud.showZombieBanner(`ROUND ${e.round ?? 0} LIMPO`, "Próxima horda…", 3);
  });

  r.onMessage("shot", (e: {
    shooterId: string;
    targetId: string;
    hit: boolean;
    headshot?: boolean;
    endX: number;
    endY: number;
    endZ: number;
  }) => {
    if (!inGame) return;
    const from = shooterHead(e.shooterId);
    if (!from) return;
    const rp = remotePlayers.get(e.shooterId);
    const end = new Vector3(e.endX, e.endY, e.endZ);
    const incoming = end.subtract(from);
    const travel = effects.spawnTracer(from, end, rp?.isPredator === true);
    effects.spawnImpact(end, e.hit, incoming, null, travel, Boolean(e.headshot));
    audio.remoteShot(from);
    rp?.visual.triggerShoot();
  });

  r.onMessage("remoteShots", (e: {
    shooterId: string;
    ends: Array<{ x: number; y: number; z: number; hit?: boolean; head?: boolean }>;
  }) => {
    if (!inGame) return;
    const from = shooterHead(e.shooterId);
    if (!from) return;
    const rp = remotePlayers.get(e.shooterId);
    for (const end of e.ends) {
      const to = new Vector3(end.x, end.y, end.z);
      const travel = effects.spawnTracer(from, to, rp?.isPredator === true);
      const onFlesh = Boolean(end.hit) || impactHitsPlayer(to, e.shooterId);
      const headshot = Boolean(end.head) || (onFlesh && impactHitsHead(to, e.shooterId));
      effects.spawnImpact(to, onFlesh, to.subtract(from), null, travel, headshot);
    }
    audio.remoteShot(from);
    rp?.visual.triggerShoot();
  });

  r.onMessage("heliExploded", (e: { x: number; y: number; z: number }) => {
    if (!inGame) return;
    effects.spawnExplosion(new Vector3(e.x, e.y, e.z));
    audio.explosion();
  });

  r.onMessage("debugShot", (e: {
    origin: { x: number; y: number; z: number };
    ends: Array<{ x: number; y: number; z: number }>;
  }) => {
    if (!inGame || !devTracers) return;
    const origin = new Vector3(e.origin.x, e.origin.y, e.origin.z);
    for (const end of e.ends) {
      effects.spawnDebugTracer(origin, new Vector3(end.x, end.y, end.z));
    }
  });

  r.onMessage("matchEnd", () => {
    if (!inGame) return;
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
  let lastKillsToWin = -1;
  r.onStateChange(() => {
    const snap = getMatchSnapshot(r);
    if (snap.killsToWin !== lastKillsToWin) {
      lastKillsToWin = snap.killsToWin;
      hud.setKillsTarget(snap.killsToWin);
    }
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

  syncDevOptionsToServer();

  r.onMessage("matchReset", () => {
    endScreenShown = false;
    hud.hideEndScreen();
    hud.setKills(0);
    hud.clearAllKillStreaks();
  });

  r.onMessage("sessionReplaced", (msg: { message?: string }) => {
    handleSessionReplaced(
      typeof msg?.message === "string"
        ? msg.message
        : "Você foi desconectado porque entrou em outro dispositivo."
    );
  });

  r.onLeave((code) => {
    window.clearInterval(pingInterval);
    if (code === SESSION_REPLACED_LEAVE_CODE) {
      handleSessionReplaced(
        "Você foi desconectado porque entrou em outro dispositivo."
      );
      return;
    }
    resetToMenu(
      code === 4000
        ? "Você foi removido da sala pelo líder."
        : code > 1000
          ? "Desconectado do servidor."
          : undefined
    );
  });
}

function impactHitsHead(at: Vector3, shooterId: string): boolean {
  const nearHead = (feet: Vector3): boolean => {
    const dx = at.x - feet.x;
    const dz = at.z - feet.z;
    if (dx * dx + dz * dz > 0.55 * 0.55) return false;
    const localY = at.y - feet.y;
    return localY > 1.42 && localY < 2.15;
  };

  if (nearHead(player.getFeet())) return true;
  for (const [id, rp] of remotePlayers) {
    if (id === shooterId) continue;
    if (nearHead(rp.getFeet())) return true;
  }
  return false;
}

function impactHitsPlayer(at: Vector3, shooterId: string): boolean {
  const nearFeet = (feet: Vector3): boolean => {
    const dx = at.x - feet.x;
    const dz = at.z - feet.z;
    if (dx * dx + dz * dz > 0.85 * 0.85) return false;
    const localY = at.y - feet.y;
    return localY > -0.15 && localY < 2.15;
  };

  if (nearFeet(player.getFeet())) return true;
  for (const [id, rp] of remotePlayers) {
    if (id === shooterId) continue;
    if (nearFeet(rp.getFeet())) return true;
  }
  return false;
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
      rp.setDebugHitboxes(devHitbox);
      rp.applyState(p.x, p.y, p.z, p.yaw, p.alive, Boolean(p.crouch), p.downed === true);
      rp.snapToTarget();
    } else {
      rp.applyState(p.x, p.y, p.z, p.yaw, p.alive, Boolean(p.crouch), p.downed === true);
    }
    rp.setZombieAppearance(p.isZombie === true, p.isBoss === true);
    rp.setSkin(p.skinId || "skin_default");
    if (p.isZombie !== true) {
      const remoteWeapon = p.weaponId || "m4a1";
      const fromState = decodeWeaponSkinLooks(p.weaponSkinParts);
      const catalog = !fromState && p.weaponSkinId ? getWeaponSkin(p.weaponSkinId) : undefined;
      rp.setWeaponAppearance(
        remoteWeapon,
        p.weaponSkinId || "",
        fromState?.parts ?? (catalog && catalog.weaponId === remoteWeapon ? catalog.parts : null),
        fromState?.textures ?? (catalog && catalog.weaponId === remoteWeapon ? catalog.textures ?? null : null)
      );
    }
    rp.setPredator(isPredatorStreak(p.activeStreak));
    rp.setParachuting(p.parachuting === true);
    rp.setWallhack(ownHasWallhack);
    rp.setInvincible((p.invincibleTimeLeft ?? 0) > 0);
    if (p.isZombie === true && !p.alive) audio.stopZombieVoice(id);
  });

  updateNametags(r, ownSnapshot?.team ?? "");

  const snap = getMatchSnapshot(r);
  hud.setScoreMode(
    isZombiesMode(snap.gameMode) ? "zombies" : isTdmMode(snap.gameMode) ? "tdm" : "ffa"
  );
  hud.setKillsTarget(snap.killsToWin);
  if (isTdmMode(snap.gameMode)) {
    hud.setTeamScores(snap.teamKillsAlpha, snap.teamKillsEcho);
  }
  if (isZombiesMode(snap.gameMode)) {
    hud.setZombieHud(snap.zombieRound, snap.zombiesLeft);
    syncAmmoDrops(r);
    updateRevivePrompt(r, ownSnapshot);
    let bossHp = 0;
    let bossMax = 0;
    let bossName = "Zumbi Boss";
    forEachPlayer(r, (p) => {
      if (p.isBoss === true && p.alive) {
        bossHp = p.health;
        bossMax = zombieMaxHealth(true);
        if (p.name) bossName = p.name;
      }
    });
    hud.setBossHealth(bossHp, bossMax, bossName);
  } else {
    hud.setBossHealth(0, 0);
  }
  if (scoreboardOpen) refreshMatchScoreboard();

  for (const [id, rp] of remotePlayers) {
    if (!seen.has(id)) {
      audio.stopZombieVoice(id);
      rp.dispose();
      remotePlayers.delete(id);
    }
  }

  const state = r.state as { matchOver?: boolean; winnerName?: string };
  if (state.matchOver && !endScreenShown) {
    endScreenShown = true;
    closeMatchScoreboard(false);
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
    const own = getOwnSnapshot(r);
    // XP da partida + detecção de promoção (patente antes/depois).
    const earned = own?.matchXp ?? 0;
    const xpAfter = own?.xp ?? 0;
    const rankBefore = rankForXp(Math.max(0, xpAfter - earned));
    const rankAfter = rankForXp(xpAfter);
    const playerWon = isZombiesMode(snap.gameMode)
      ? false
      : isTdmMode(snap.gameMode)
      ? Boolean(own?.team && own.team === snap.winnerTeam)
      : state.winnerName === own?.name;
    const xpLines: Array<{ label: string; xp: number }> = [];
    const goldLines: Array<{ label: string; gold: number }> = [];
    if (earned > 0 && own) {
      xpLines.push({ label: "Partida jogada", xp: XP_RULES.matchPlayed });
      goldLines.push({ label: "Partida jogada", gold: GOLD_RULES.matchPlayed });
      if (own.kills > 0) {
        xpLines.push({
          label: `${own.kills} kill${own.kills > 1 ? "s" : ""}`,
          xp: own.kills * XP_RULES.kill,
        });
        goldLines.push({
          label: `${own.kills} kill${own.kills > 1 ? "s" : ""}`,
          gold: own.kills * GOLD_RULES.kill,
        });
      }
      if (own.doubleKills > 0) {
        xpLines.push({
          label: `Double kill ×${own.doubleKills}`,
          xp: own.doubleKills * XP_RULES.doubleKill,
        });
        goldLines.push({
          label: `Double kill ×${own.doubleKills}`,
          gold: own.doubleKills * GOLD_RULES.doubleKill,
        });
      }
      if (own.tripleKills > 0) {
        xpLines.push({
          label: `Triple kill ×${own.tripleKills}`,
          xp: own.tripleKills * XP_RULES.tripleKill,
        });
        goldLines.push({
          label: `Triple kill ×${own.tripleKills}`,
          gold: own.tripleKills * GOLD_RULES.tripleKill,
        });
      }
      if (own.multiKills > 0) {
        xpLines.push({
          label: `Multi kill ×${own.multiKills}`,
          xp: own.multiKills * XP_RULES.multiKill,
        });
        goldLines.push({
          label: `Multi kill ×${own.multiKills}`,
          gold: own.multiKills * GOLD_RULES.multiKill,
        });
      }
      if (playerWon) {
        xpLines.push({ label: "Vitória", xp: XP_RULES.victory });
        goldLines.push({ label: "Vitória", gold: GOLD_RULES.victory });
      }
    }
    hud.showEndScreen(
      state.winnerName ?? "?",
      playerWon,
      scoreboardRows(r),
      {
        earned,
        rankName: rankAfter.name,
        rankIcon: rankIconUrl(rankAfter),
        rankedUp: earned > 0 && rankAfter.id !== rankBefore.id,
        lines: xpLines,
        gold: { earned: own?.matchGold ?? 0, lines: goldLines },
      }
    );
    document.exitPointerLock();
  }
}

function setLocalPredator(on: boolean, p?: PlayerSnapshot): void {
  if (localPredator === on) return;
  localPredator = on;
  hud.setPredatorHud(on);
  weapons.setStreakWeapon(on ? "minigun" : null);
  player.setPredatorMode(on, PREDATOR.eyeY);
  player.setThirdPersonPeekAllowed(!on);
  exitAdsImmediate();
  if (on) {
    localHeliLinger = 0;
    localParachute = false;
    player.setParachuteMode(false);
    localChute?.setEnabled(false);
    if (p) player.teleport(new Vector3(p.x, p.y, p.z));
    player.setPitch(0.62);
    lastKnownHealth = typeof p?.heliHp === "number" ? p.heliHp : PREDATOR.hp;
    hud.setHealth(lastKnownHealth, PREDATOR.hp);
    viewModel.setWeapon(weapons.weapon);
    viewModel.setVisible(true);
    if (!localHeli) localHeli = new HelicopterVisual(scene, "local");
    localHeli.setEnabled(true);
    audio.startHeliRotor();
  } else {
    const lingerPos = player.getFeet();
    const lingerYaw = player.getYaw();
    player.setPitch(0);
    const survived = Boolean(p?.alive) && !playerDead;
    if (p && survived) player.teleport(new Vector3(p.x, p.y, p.z));
    viewModel.setWeapon(weapons.weapon);
    applyEquippedSkinToViewModel(weapons.weapon.id);
    viewModel.setVisible(!playerDead && !awaitingSpawn);
    audio.stopHeliRotor();
    hud.setPredatorHud(false);
    if (survived) {
      localHeliLinger = PREDATOR.heliLinger;
      if (!localHeli) localHeli = new HelicopterVisual(scene, "local");
      localHeli.setPose(lingerPos.x, lingerPos.y, lingerPos.z, lingerYaw);
      localHeli.setEnabled(true);
    } else {
      localHeliLinger = 0;
      localHeli?.setEnabled(false);
    }
    if (!playerDead) {
      hud.setHealth(p?.health ?? lastKnownHealth);
      lastKnownHealth = p?.health ?? lastKnownHealth;
    }
  }
}

function setLocalParachute(on: boolean, p?: PlayerSnapshot): void {
  if (localParachute === on) return;
  localParachute = on;
  if (on) {
    if (p) player.teleport(new Vector3(p.x, p.y, p.z));
    player.setParachuteMode(true);
    if (!localChute) localChute = new ParachuteVisual(scene, "local");
    localChute.setEnabled(true);
  } else {
    player.setParachuteMode(false);
    localChute?.setEnabled(false);
  }
}

function handleOwnState(p: PlayerSnapshot): void {
  if (awaitingSpawn || isGhostSpectating()) {
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

  if (!isPredatorStreak(p.activeStreak) && p.health !== lastKnownHealth) {
    if (p.health < lastKnownHealth) {
      hud.flashDamage();
      audio.damaged();
    }
    hud.setHealth(p.health);
    lastKnownHealth = p.health;
  }
  hud.setKills(p.kills);
  hud.setKillStreak(p.killStreak);
  hud.updateAvailableStreaks(
    streakIdsForHud(
      p.availableStreaks ? Array.from(p.availableStreaks) : [],
      p.activeStreak
    ),
    p.activeStreak
  );
  hud.updateActiveStreak(p.activeStreak, p.streakTimeLeft);
  weapons.setNoRecoil(p.activeStreak === "no_recoil");
  const wantPredator = isPredatorStreak(p.activeStreak);
  if (wantPredator !== localPredator) {
    setLocalPredator(wantPredator, p);
  } else if (wantPredator && !playerDead) {
    const feet = player.getFeet();
    if (Math.hypot(feet.x - p.x, feet.y - p.y, feet.z - p.z) > 4) {
      player.teleport(new Vector3(p.x, p.y, p.z));
    }
  }
  const wantParachute = p.parachuting === true;
  if (wantParachute !== localParachute) {
    setLocalParachute(wantParachute, p);
  }
  if (wantPredator) {
    const heliHp = typeof p.heliHp === "number" ? p.heliHp : PREDATOR.hp;
    if (heliHp !== lastKnownHealth) {
      if (heliHp < lastKnownHealth) {
        hud.flashDamage();
        audio.damaged();
      }
      hud.setHealth(heliHp, PREDATOR.hp);
      lastKnownHealth = heliHp;
    }
  }
  const invincible = (p.invincibleTimeLeft ?? 0) > 0;
  viewModel.setInvincible(invincible);
  localPlayerVisual?.setInvincible(invincible);
  hud.setInvincibleVignette(invincible);
}

function clearAmmoDropMeshes(): void {
  for (const m of ammoDropMeshes.values()) m.dispose();
  ammoDropMeshes.clear();
}

function syncAmmoDrops(r: Room): void {
  const drops = (r.state as { ammoDrops?: { forEach: Function } }).ammoDrops;
  const seen = new Set<string>();
  drops?.forEach((d: { x: number; y: number; z: number }, id: string) => {
    seen.add(id);
    let mesh = ammoDropMeshes.get(id);
    if (!mesh) {
      mesh = MeshBuilder.CreateBox(`ammoDrop_${id}`, { size: 0.38 }, scene);
      const mat = new StandardMaterial(`ammoDropMat_${id}`, scene);
      mat.diffuseColor = new Color3(0.85, 0.72, 0.22);
      mat.emissiveColor = new Color3(0.28, 0.22, 0.04);
      mesh.material = mat;
      mesh.isPickable = false;
      ammoDropMeshes.set(id, mesh);
    }
    mesh.position.set(d.x, (d.y ?? 0) + 0.28, d.z);
    mesh.rotation.y += 0.02;
  });
  for (const [id, mesh] of ammoDropMeshes) {
    if (seen.has(id)) continue;
    mesh.dispose();
    ammoDropMeshes.delete(id);
  }
}

function updateRevivePrompt(r: Room, own: PlayerSnapshot | null): void {
  if (!own || !own.alive || own.downed || playerDead) {
    hud.setRevivePrompt(false);
    return;
  }
  let nearest: PlayerSnapshot | null = null;
  let best = 2.5;
  let progress = 0;
  forEachPlayer(r, (p) => {
    if (!p.downed || p.isZombie) return;
    const d = Math.hypot(p.x - own.x, p.z - own.z);
    if (d < best) {
      best = d;
      nearest = p;
      progress = p.reviveProgress ?? 0;
    }
  });
  hud.setRevivePrompt(Boolean(nearest), progress);
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
    // Quem ficou no pré-lobby não aparece no placar da partida.
    if (!p.inMatch || p.isZombie === true) return;
    rows.push({
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      isPlayer: id === r.sessionId,
      isHost: id === hostId,
      xp: p.xp ?? 0,
      team: typeof p.team === "string" ? p.team : "",
      userId: p.userId ?? 0,
      isBot: p.isBot === true,
    });
  });
  return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

weapons.onFire = (data) => {
  if (!room || isGhostSpectating() || playerDead) return;
  const weaponId = weapons.weapon.id;
  const skin = getVisualWeaponSkin(weaponId);
  room.send("fire", {
    weaponId,
    weaponSkinId: skin.id,
    weaponSkinParts: encodeWeaponSkinParts(skin.parts, skin.textures),
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
  syncVisualToServer();
};

const HIP_FOV = 1.15;
const SCOPE_FOV = 0.42;
const scopeOverlay = document.getElementById("scopeOverlay")!;
const scopeOverlayCanvas = document.getElementById(
  "scopeOverlayCanvas",
) as HTMLCanvasElement;

let adsToggled = false;
let adsOverlayOn = false;
let adsCrosshairScoped = false;
let lastAdsFov = HIP_FOV;

function canAds(): boolean {
  return (
    player.isPointerLocked &&
    weapons.weapon.id === "awp" &&
    !playerDead &&
    !isGhostSpectating() &&
    !localPredator &&
    // Correndo (mesmo no ar) o scope fica bloqueado — arma está levantada.
    !(player.isRunning && player.isMoving)
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

const SCOPE_LINE_BLUR_WALK = 2.8;

let scopeLineBlur = 0;
let scopeLineBlurPainted = -1;

function paintScopeOverlay(lineBlurCss = 0): void {
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

  const blurPx = lineBlurCss * dpr;
  if (blurPx > 0.05) ctx.filter = `blur(${blurPx}px)`;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  ctx.filter = "none";
}

function updateScopeOverlayBlur(dt: number): void {
  if (!adsOverlayOn) {
    if (scopeLineBlur !== 0) {
      scopeLineBlur = 0;
      scopeLineBlurPainted = -1;
    }
    return;
  }

  const target = player.isMovingOnGround ? SCOPE_LINE_BLUR_WALK : 0;
  scopeLineBlur += (target - scopeLineBlur) * Math.min(1, dt * 14);
  if (Math.abs(scopeLineBlur - scopeLineBlurPainted) > 0.06) {
    scopeLineBlurPainted = scopeLineBlur;
    paintScopeOverlay(scopeLineBlur);
  }
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
  viewModel.setVisible(!playerDead && !isGhostSpectating() && !awaitingSpawn);
  setScopeOverlay(false);
  setCrosshairScoped(false);
  player.setSensitivity(baseSensitivity);
}

function updateAds(dt: number): void {
  if (awaitingSpawn || isGhostSpectating()) {
    adsHiddenByOverlay = true;
    viewModel.setVisible(false);
    return;
  }
  if (localPredator) {
    adsHiddenByOverlay = false;
    viewModel.setVisible(true);
    if (lastAdsFov !== HIP_FOV) {
      lastAdsFov = HIP_FOV;
      player.camera.fov = HIP_FOV;
    }
    setScopeOverlay(false);
    setCrosshairScoped(false);
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

  const peeking = player.isThirdPersonPeeking;
  const peekChanged = peeking !== lastThirdPersonPeek;
  lastThirdPersonPeek = peeking;
  const overlayChanged = adsHiddenByOverlay;
  adsHiddenByOverlay = false;

  if (adsAmount === prevAmount && adsAmount === target && !peekChanged && !overlayChanged) return;

  viewModel.setVisible(adsAmount < 0.45 && !peeking);
  setScopeOverlay(adsAmount > 0.5 && !peeking);
  setCrosshairScoped(adsAmount > 0.35);
  player.setSensitivity(
    baseSensitivity * (1 - adsAmount * (1 - ADS_SENS_SCALE)),
  );
}

canvas.addEventListener("mousedown", (e) => {
  if (!player.isPointerLocked) return;
  if (isGhostSpectating() || playerDead || awaitingSpawn) return;
  if (e.button === 0) {
    weapons.setTrigger(true);
  }
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
  if (e.button === 0) {
    weapons.setTrigger(false);
  }
});
canvas.addEventListener("contextmenu", (e) => {
  if (player.isPointerLocked) e.preventDefault();
});
window.addEventListener("wheel", (e) => {
  if (!player.isPointerLocked || localPredator || isGhostSpectating()) return;
  const from = weapons.weaponIndex;
  weapons.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  rememberWeaponSwitch(from);
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Tab" && inGame) {
    e.preventDefault();
    if (endScreenShown || e.repeat) return;
    if (loadoutPicking || chatTyping) return;
    openMatchScoreboard();
    return;
  }
  if (e.code === "Enter" && inGame && player.isPointerLocked && !isEditableTarget(e.target)) {
    e.preventDefault();
    openChat();
    return;
  }
  if (loadoutPicking || chatTyping || isEditableTarget(e.target)) return;
  if (e.code === "KeyI") {
    e.preventDefault();
    if (awaitingSpawn) {
      if (freeSpectating && !loadoutPicking) openLoadoutModal(false);
      return;
    }
    if (matchSpectating || (freeSpectating && inGame)) {
      openLoadoutModal(true);
      return;
    }
    if (!player.isPointerLocked) return;
    if (!playerDead && !endScreenShown && !localPredator) openLoadoutModal(true);
    return;
  }
  if (!player.isPointerLocked) return;
  if (isGhostSpectating() || playerDead) return;
  if (e.code === "KeyR") weapons.startReload();
  if (e.code === "KeyF") {
    e.preventDefault();
    if (!reviveHolding && isZombiesMode(currentGameMode())) {
      reviveHolding = true;
      room?.send("holdRevive", { holding: true });
    }
  }
  if (e.code === "KeyQ") {
    e.preventDefault();
    switchTo(lastWeaponIndex);
  }
  if (trySendActivateStreak(e.code, e.key)) e.preventDefault();
  if (e.code === "Digit1") switchTo(0);
  if (e.code === "Digit2") switchTo(1);
  if (e.code === "Digit3") switchTo(2);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "KeyF" && reviveHolding) {
    reviveHolding = false;
    room?.send("holdRevive", { holding: false });
  }
  if (e.code === "Tab" && inGame) {
    e.preventDefault();
    if (endScreenShown) return;
    closeTeamSwitchConfirm();
    closeMatchScoreboard(!awaitingSpawn);
  }
});
window.addEventListener("blur", () => {
  if (!inGame || endScreenShown || !scoreboardOpen) return;
  closeTeamSwitchConfirm();
  closeMatchScoreboard(!awaitingSpawn);
});

function trySendActivateStreak(code: string, key = ""): boolean {
  if (isZombiesMode(currentGameMode())) return false;
  const reward = killStreakRewardForKey(code, key);
  if (!reward) return false;
  if (room && inGame && !playerDead && !awaitingSpawn && !endScreenShown && !isGhostSpectating()) {
    room.send("activateStreak", { id: reward.id });
  }
  return true;
}

function rememberWeaponSwitch(fromIndex: number): void {
  if (weapons.weaponIndex === fromIndex) return;
  lastWeaponIndex = fromIndex;
  viewModel.setWeapon(weapons.weapon);
  applyEquippedSkinToViewModel(weapons.weapon.id);
  player.setSpeedMult(weaponMoveSpeedMult(weapons.weapon));
  localVisualWeaponId = "";
  exitAds();
}

function switchTo(index: number): void {
  if (localPredator || isGhostSpectating()) return;
  const from = weapons.weaponIndex;
  weapons.switchWeapon(index);
  rememberWeaponSwitch(from);
}

restartButton.addEventListener("click", () => {
  hud.hideEndScreen();
  audio.resume();
  returnToLobby();
});

menuButton.addEventListener("click", () => {
  void room?.leave();
});

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

    // Trava a tecla Escape no navegador para que o ESC abra apenas o menu de pausa/jogo
    // e não desarme o fullscreen do navegador (F11 continua como tecla nativa).
    if ("keyboard" in navigator && typeof (navigator as any).keyboard?.lock === "function") {
      (navigator as any).keyboard.lock(["Escape"]).catch(() => {});
    }
  } else if (inGame && !endScreenShown) {
    exitAdsImmediate();
    if (chatTyping || loadoutPicking || scoreboardOpen || teamSwitchOpen) return;
    if (playerDead || pendingSpectateAfterDeath || isGhostSpectating()) return;
    if (awaitingSpawn && !freeSpectating) return;
    openPauseModal();
  }
});

  window.addEventListener(
  "keydown",
  (e) => {
    if (e.code !== "Escape" || endScreenShown) return;

    // Overlays do Social têm prioridade sobre o menu de pausa.
    if (socialPanel.handleEscape()) {
      e.preventDefault();
      return;
    }

    if (!inGame && !createRoomModal.classList.contains("hidden")) {
      e.preventDefault();
      closeCreateRoomModal();
      return;
    }

    if (!inGame && !inventoryModal.classList.contains("hidden")) {
      e.preventDefault();
      closeInventoryModal();
      return;
    }

    if (!inGame && !shopModal.classList.contains("hidden")) {
      e.preventDefault();
      closeShopModal();
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

    if (teamSwitchOpen) {
      e.preventDefault();
      closeTeamSwitchConfirm();
      return;
    }

    if (scoreboardOpen) {
      e.preventDefault();
      closeMatchScoreboard(!awaitingSpawn);
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

if (shopPreviewCanvas) {
  shopPreview = new SkinPreview(shopPreviewCanvas);
  shopPreview.setSkin(getActiveSkin());
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

  const canThirdPersonPeek =
    !awaitingSpawn &&
    !playerDead &&
    !endScreenShown &&
    !loadoutPicking &&
    !scoreboardOpen &&
    !chatTyping &&
    !player.isSpectating &&
    !freeSpectating &&
    !localPredator;
  player.setThirdPersonPeekAllowed(canThirdPersonPeek);

  player.update(dt);
  player.updateRecoil(dt);

  updateLocalPlayerVisual(dt);
  crosshairEl.style.visibility = player.isThirdPersonPeeking ? "hidden" : "";

  audio.setListener({
    x: player.getHead().x,
    y: player.getHead().y,
    z: player.getHead().z,
    yaw: player.getYaw(),
  });
  weapons.setCrouching(player.isCrouching);
  weapons.setAirborne(!player.isGrounded);
  weapons.setMoving(player.isMovingOnGround);
  weapons.setRunning(player.isRunning);
  // Sprint de verdade exige movimento: parado segurando Shift não levanta a arma.
  // isMoving (sem exigir chão) mantém a arma levantada ao pular correndo.
  const sprinting = player.isRunning && player.isMoving;
  weapons.setSprinting(sprinting);
  viewModel.setSprinting(sprinting);
  weapons.update(dt);
  updateAds(dt);
  if (isGhostSpectating()) {
    weapons.setEnabled(false);
    weapons.setTrigger(false);
    viewModel.setVisible(false);
  }
  updateScopeOverlayBlur(dt);
  viewModel.update(dt);
  if (localHeli && (localPredator || localHeliLinger > 0)) {
    if (localPredator) {
      const feet = player.getFeet();
      localHeli.setPose(feet.x, feet.y, feet.z, player.getYaw());
    } else {
      localHeliLinger = Math.max(0, localHeliLinger - dt);
      if (localHeliLinger === 0) localHeli.setEnabled(false);
    }
    localHeli.update(dt);
  }
  if (localChute && localParachute) {
    const feet = player.getFeet();
    localChute.setPose(feet.x, feet.y, feet.z, player.getYaw());
    localChute.update(dt);
  }

  const diameter = spreadDiameterPx();
  if (devInfinite) {
    debugSpreadCircle.style.width = `${diameter}px`;
    debugSpreadCircle.style.height = `${diameter}px`;
    debugSpreadCircle.style.display = "block";
  } else {
    debugSpreadCircle.style.display = "none";
  }
  updateDynamicReticle();

  const listenHead = player.getHead();
  const nearbyZombies: { rp: RemotePlayer; d2: number }[] = [];
  let zombiesAlive = 0;
  for (const rp of remotePlayers.values()) {
    rp.update(dt, serverRttMs > 0 ? serverRttMs : pingMs ?? 0);
    if (rp.isZombieNpc()) {
      if (!rp.isAliveVisible()) {
        audio.stopZombieVoice(rp.id);
        continue;
      }
      zombiesAlive++;
      const feet = rp.getFeet();
      const dx = feet.x - listenHead.x;
      const dz = feet.z - listenHead.z;
      nearbyZombies.push({ rp, d2: dx * dx + dz * dz });
    } else if (rp.tickFootstep(dt)) {
      audio.remoteFootstep(rp.getFeet());
    }
  }
  nearbyZombies.sort((a, b) => a.d2 - b.d2);
  const hearZombie = new Set<string>();
  for (const z of nearbyZombies) {
    if (z.rp.isBossZombie() || hearZombie.size < 5) hearZombie.add(z.rp.id);
  }
  for (const { rp } of nearbyZombies) {
    const feet = rp.getFeet();
    audio.updateZombieVoice(rp.id, feet.x, feet.z);
    if (!hearZombie.has(rp.id)) continue;
    if (rp.tickFootstep(dt)) audio.zombieFootstep(feet);
    if (rp.tickZombieVoice(dt)) audio.zombieGroan(rp.id, feet, rp.isBossZombie());
  }
  if (isZombiesMode(currentGameMode())) {
    audio.tickZombieAmbience(dt, zombiesAlive);
  }
  if (room) updateNametags(room, getOwnSnapshot(room)?.team ?? "");

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
    if (deathCountdown <= 0 && pendingSpectateAfterDeath) {
      enterInMatchSpectate();
    }
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
  if (!pageHome.classList.contains("hidden")) homePreview?.resize();
  if (!pageLobby.classList.contains("hidden")) lobbyPreview?.resize();
  if (!inventoryModal.classList.contains("hidden")) {
    inventoryPreview?.resize();
    inventoryWeaponPreview?.resize();
  }
  if (!shopModal.classList.contains("hidden")) shopPreview?.resize();
  socialPanel.resizeFriendPreview();
  paintScopeOverlay(scopeLineBlur);
});

// Pinta o scope fora do combate (evita hitch no 1º RMB).
paintScopeOverlay();
requestAnimationFrame(() => paintScopeOverlay());

void (async () => {
  try {
    await initAuth();
    hydrateMapCatalog();
    if (session) navigate("/home", true);
    else navigate("/login", true);
  } finally {
    finishAppBoot();
  }
})();
