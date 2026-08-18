/** Cliente da sala Social (Colyseus): presença global, amigos e convites. */

import type { Room } from "colyseus.js";
import { getClient } from "./NetworkClient";
import { loadStoredToken } from "./authApi";

export interface FriendEntry {
  userId: number;
  name: string;
  xp: number;
}

export interface PresenceInfo {
  online: boolean;
  status: string;
  roomId: string;
  roomName: string;
  roomClients: number;
  roomMax: number;
  matchStarted: boolean;
  skinId: string;
}

export interface FriendProfile {
  id: number;
  username: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
  xp: number;
  gold: number;
  createdAt: string;
  skin: string;
}

export interface InvitePayload {
  fromUserId: number;
  fromName: string;
  roomId: string;
  roomName: string;
}

export interface SocialHandlers {
  /** Lista fresca de amigos + pedidos recebidos + pedidos enviados. */
  onLists(
    friends: FriendEntry[],
    requests: FriendEntry[],
    outgoing: FriendEntry[]
  ): void;
  /** Chegou um pedido de amizade em tempo real. */
  onRequest(from: { userId: number; name: string }): void;
  /** Chegou um convite de sala em tempo real. */
  onInvite(invite: InvitePayload): void;
  /** Feedback de uma ação minha (enviada ou não). */
  onToast(message: string, isError: boolean): void;
  /** Resposta do "Informações" — perfil + presença do amigo. */
  onInfo(userId: number, profile: FriendProfile, presence: PresenceInfo | null): void;
  /** Algo mudou na presença (alguém entrou/saiu/trocou de sala). */
  onPresence(): void;
  onDisconnect(): void;
}

export interface PresencePayload {
  status: "home" | "lobby" | "playing";
  roomId: string;
  roomName: string;
  roomClients: number;
  roomMax: number;
  matchStarted: boolean;
  skinId: string;
}

let room: Room | null = null;
let connecting: Promise<boolean> | null = null;
let handlers: SocialHandlers | null = null;

export function isSocialConnected(): boolean {
  return room !== null;
}

function wireRoom(r: Room): void {
  r.onMessage(
    "socialUpdate",
    (msg: {
      friends?: FriendEntry[];
      requests?: FriendEntry[];
      outgoing?: FriendEntry[];
    }) => {
      handlers?.onLists(msg.friends ?? [], msg.requests ?? [], msg.outgoing ?? []);
    }
  );
  r.onMessage("socialRequest", (msg: { from: { userId: number; name: string } }) => {
    if (msg?.from) handlers?.onRequest(msg.from);
  });
  r.onMessage("socialInvite", (msg: InvitePayload) => {
    if (msg?.roomId) handlers?.onInvite(msg);
  });
  r.onMessage("socialToast", (msg: { message?: string; isError?: boolean }) => {
    if (typeof msg?.message === "string") {
      handlers?.onToast(msg.message, msg.isError === true);
    }
  });
  r.onMessage(
    "socialInfo",
    (msg: { userId: number; profile: FriendProfile; presence: PresenceInfo | null }) => {
      if (msg?.profile) handlers?.onInfo(msg.userId, msg.profile, msg.presence ?? null);
    }
  );
  r.onStateChange(() => handlers?.onPresence());
  r.onLeave(() => {
    if (room === r) room = null;
    handlers?.onDisconnect();
  });
}

/** Conecta na sala social (idempotente). Requer token de conta. */
export function connectSocial(h: SocialHandlers): Promise<boolean> {
  handlers = h;
  if (room) return Promise.resolve(true);
  if (connecting) return connecting;

  const token = loadStoredToken();
  if (!token) return Promise.resolve(false);

  connecting = (async () => {
    try {
      const r = await getClient().joinOrCreate("social", { token });
      if (room) {
        // Corrida de duas conexões: descarta a excedente.
        void r.leave();
        return true;
      }
      wireRoom(r);
      room = r;
      // Só depois dos handlers registrados pedimos as listas iniciais.
      r.send("socialReady");
      return true;
    } catch {
      return false;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

export function disconnectSocial(): void {
  const r = room;
  room = null;
  if (r) void r.leave();
}

/**
 * Pede ao servidor um reenvio das listas (a resposta chega em onLists).
 * Usado pelo watchdog do painel para se curar de mensagens perdidas.
 */
export function refreshSocialLists(): void {
  room?.send("socialReady");
}

export function sendPresence(p: PresencePayload): void {
  room?.send("presence", p);
}

export function requestFriend(userId: number): void {
  room?.send("friendRequest", { userId });
}

export function requestFriendByName(username: string): void {
  room?.send("friendRequestByName", { username });
}

export function respondFriendRequest(userId: number, accept: boolean): void {
  room?.send("friendRespond", { userId, accept });
}

export function removeFriend(userId: number): void {
  room?.send("friendRemove", { userId });
}

export function requestFriendInfo(userId: number): void {
  room?.send("friendInfo", { userId });
}

export function inviteFriend(userId: number): void {
  room?.send("invite", { userId });
}

interface PresenceRow {
  userId?: number;
  status?: string;
  roomId?: string;
  roomName?: string;
  roomClients?: number;
  roomMax?: number;
  matchStarted?: boolean;
  skinId?: string;
}

/** Presença de um usuário online (null = offline ou não conectado). */
export function presenceFor(userId: number): PresenceInfo | null {
  if (!room) return null;
  const users = (room.state as { users?: { forEach: Function } }).users;
  let found: PresenceInfo | null = null;
  users?.forEach((u: PresenceRow) => {
    if (found || u.userId !== userId) return;
    found = {
      online: true,
      status: typeof u.status === "string" ? u.status : "home",
      roomId: typeof u.roomId === "string" ? u.roomId : "",
      roomName: typeof u.roomName === "string" ? u.roomName : "",
      roomClients: typeof u.roomClients === "number" ? u.roomClients : 0,
      roomMax: typeof u.roomMax === "number" ? u.roomMax : 0,
      matchStarted: u.matchStarted === true,
      skinId: typeof u.skinId === "string" ? u.skinId : "skin_default",
    };
  });
  return found;
}
