import { Client, Room } from "colyseus.js";
import { CONFIG } from "../../shared/config";
import { loadStoredToken } from "./authApi";

export interface PlayerSnapshot {
  name: string;
  /** Id da conta autenticada (0 = convidado) — usado pelo Social. */
  userId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  kills: number;
  deaths: number;
  alive: boolean;
  /** Agachado — usado no visual dos remotos. */
  crouch: boolean;
  // Reconciliação (apenas para o próprio jogador):
  vy: number;
  grounded: boolean;
  lastSeq: number;

  // Sistema de Kill Streaks
  killStreak: number;
  activeStreak: string;
  streakTimeLeft: number;
  invincibleTimeLeft: number;
  /** Streaks liberados aguardando ativação (ArraySchema no runtime). */
  availableStreaks: string[];
  skinId: string;
  weaponId: string;
  weaponSkinId: string;

  // Pré-lobby
  ready: boolean;
  inMatch: boolean;
  isBot: boolean;

  // Patentes (XP de carreira / XP da partida)
  xp: number;
  matchXp: number;
  /** Multi-kills da partida (detalhamento do XP na tela de fim). */
  doubleKills: number;
  tripleKills: number;
  multiKills: number;

  // Gold (total acumulado / ganho na partida)
  gold: number;
  matchGold: number;
  /** Time no tdm: "alpha" | "echo" | "". */
  team: string;
}

export interface MatchSnapshot {
  hostId: string;
  roomName: string;
  desiredBots: number;
  maxPlayers: number;
  matchOver: boolean;
  winnerName: string;
  gameMode: string;
  killsToWin: number;
  mapId: string;
  matchStarted: boolean;
  mapPayload: string;
  teamKillsAlpha: number;
  teamKillsEcho: number;
  winnerTeam: string;
}

let cachedClient: Client | null = null;

/** URL do Colyseus: em `vite` (dev) usa localhost; em build usa VITE_SERVER_URL. */
function getServerUrl(): string {
  if (import.meta.env.DEV) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:${CONFIG.serverPort}`;
  }
  const envUrl = import.meta.env.VITE_SERVER_URL?.trim();
  if (envUrl) return envUrl;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:${CONFIG.serverPort}`;
}

/** Cliente Colyseus compartilhado (mata-mata e sala social usam o mesmo). */
export function getClient(): Client {
  if (!cachedClient) {
    cachedClient = new Client(getServerUrl());
  }
  return cachedClient;
}

function joinOptions(name: string): { name: string; token?: string } {
  const token = loadStoredToken();
  return token ? { name, token } : { name };
}

/** Opções ao criar uma sala (além do nome do jogador). */
export interface CreateRoomOptions {
  roomName: string;
  bots: number;
  maxPlayers: number;
  gameMode: string;
  killsToWin: number;
  mapId: string;
  customMap?: unknown;
}

/** Entrada da lista de salas do lobby. */
export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  map: string;
  name: string;
  bots: number;
  gameMode: string;
  killsToWin: number;
  matchStarted: boolean;
}

type RoomMetadata = {
  map?: string;
  name?: string;
  bots?: number;
  maxPlayers?: number;
  gameMode?: string;
  killsToWin?: number;
  matchStarted?: boolean;
};

/** Lista as salas de mata-mata disponíveis (não cheias). */
export async function listRooms(): Promise<RoomListing[]> {
  const rooms = await getClient().getAvailableRooms("deathmatch");
  return rooms.map((r) => {
    const meta = (r.metadata as RoomMetadata | undefined) ?? {};
    return {
      roomId: r.roomId,
      clients: r.clients,
      maxClients: r.maxClients,
      map: meta.map ?? "?",
      name: meta.name?.trim() || `Sala ${r.roomId.slice(0, 6)}`,
      bots: typeof meta.bots === "number" ? meta.bots : 0,
      gameMode: typeof meta.gameMode === "string" ? meta.gameMode : "ffa",
      killsToWin: typeof meta.killsToWin === "number" ? meta.killsToWin : 20,
      matchStarted: meta.matchStarted === true,
    };
  });
}

/** Cria uma sala nova e entra nela. */
export async function createRoom(
  name: string,
  settings: CreateRoomOptions
): Promise<Room> {
  return getClient().create("deathmatch", {
    ...joinOptions(name),
    roomName: settings.roomName,
    bots: settings.bots,
    maxPlayers: settings.maxPlayers,
    gameMode: settings.gameMode,
    killsToWin: settings.killsToWin,
    mapId: settings.mapId,
    customMap: settings.customMap,
  });
}

/** Entra numa sala existente pelo id. */
export async function joinRoomById(roomId: string, name: string): Promise<Room> {
  return getClient().joinById(roomId, joinOptions(name));
}

/** Lê o mapa de players do estado (schema decodificado por reflexão). */
export function forEachPlayer(
  room: Room,
  fn: (snapshot: PlayerSnapshot, id: string) => void
): void {
  const players = (room.state as { players?: { forEach: Function } }).players;
  players?.forEach((p: PlayerSnapshot, id: string) => fn(p, id));
}

/** Lê campos de configuração da sala no estado sincronizado. */
export function getMatchSnapshot(room: Room): MatchSnapshot {
  const s = room.state as Partial<MatchSnapshot>;
  return {
    hostId: typeof s.hostId === "string" ? s.hostId : "",
    roomName: typeof s.roomName === "string" ? s.roomName : "Sala",
    desiredBots: typeof s.desiredBots === "number" ? s.desiredBots : 0,
    maxPlayers: typeof s.maxPlayers === "number" ? s.maxPlayers : CONFIG.roomSize,
    matchOver: s.matchOver === true,
    winnerName: typeof s.winnerName === "string" ? s.winnerName : "",
    gameMode: typeof s.gameMode === "string" ? s.gameMode : "ffa",
    killsToWin: typeof s.killsToWin === "number" ? s.killsToWin : CONFIG.killsToWin,
    mapId: typeof s.mapId === "string" ? s.mapId : "praca",
    matchStarted: s.matchStarted === true,
    mapPayload: typeof s.mapPayload === "string" ? s.mapPayload : "",
    teamKillsAlpha: typeof s.teamKillsAlpha === "number" ? s.teamKillsAlpha : 0,
    teamKillsEcho: typeof s.teamKillsEcho === "number" ? s.teamKillsEcho : 0,
    winnerTeam: typeof s.winnerTeam === "string" ? s.winnerTeam : "",
  };
}
