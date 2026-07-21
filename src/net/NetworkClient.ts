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

/** Conecta ao servidor e entra (ou cria) a sala de mata-mata. */
export async function joinDeathmatch(name: string): Promise<Room> {
  const url = `ws://${window.location.hostname}:${CONFIG.serverPort}`;
  const client = new Client(url);
  return client.joinOrCreate("deathmatch", { name });
}

/** Lê o mapa de players do estado (schema decodificado por reflexão). */
export function forEachPlayer(
  room: Room,
  fn: (snapshot: PlayerSnapshot, id: string) => void
): void {
  const players = (room.state as { players?: { forEach: Function } }).players;
  players?.forEach((p: PlayerSnapshot, id: string) => fn(p, id));
}
