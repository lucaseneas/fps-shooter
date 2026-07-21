import { Client, Room } from "colyseus.js";
import { CONFIG } from "../../shared/config";

export interface PlayerSnapshot {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  kills: number;
  deaths: number;
  alive: boolean;
  // Reconciliação (apenas para o próprio jogador):
  vy: number;
  grounded: boolean;
  lastSeq: number;
}

let cachedClient: Client | null = null;

function getClient(): Client {
  if (!cachedClient) {
    const url = `ws://${window.location.hostname}:${CONFIG.serverPort}`;
    cachedClient = new Client(url);
  }
  return cachedClient;
}

/** Entrada da lista de salas do lobby. */
export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  map: string;
}

/** Lista as salas de mata-mata disponíveis (não cheias). */
export async function listRooms(): Promise<RoomListing[]> {
  const rooms = await getClient().getAvailableRooms("deathmatch");
  return rooms.map((r) => ({
    roomId: r.roomId,
    clients: r.clients,
    maxClients: r.maxClients,
    map: (r.metadata as { map?: string } | undefined)?.map ?? "?",
  }));
}

/** Cria uma sala nova e entra nela. */
export async function createRoom(name: string): Promise<Room> {
  return getClient().create("deathmatch", { name });
}

/** Entra numa sala existente pelo id. */
export async function joinRoomById(roomId: string, name: string): Promise<Room> {
  return getClient().joinById(roomId, { name });
}

/** Lê o mapa de players do estado (schema decodificado por reflexão). */
export function forEachPlayer(
  room: Room,
  fn: (snapshot: PlayerSnapshot, id: string) => void
): void {
  const players = (room.state as { players?: { forEach: Function } }).players;
  players?.forEach((p: PlayerSnapshot, id: string) => fn(p, id));
}
