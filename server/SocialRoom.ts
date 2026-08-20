import { Room, Client } from "colyseus";

import { SocialState, SocialUserState } from "./schema";
import { authenticateToken } from "./auth";
import { isAuthEnabled } from "./db";
import { bindClient, unbindClient } from "./sessionRegistry";
import * as social from "./social";

const VALID_STATUS = new Set(["home", "lobby", "playing"]);

interface PresenceMessage {
  status?: unknown;
  roomId?: unknown;
  roomName?: unknown;
  roomClients?: unknown;
  roomMax?: unknown;
  matchStarted?: unknown;
  skinId?: unknown;
}

interface UserIdMessage {
  userId?: unknown;
}

interface RespondMessage extends UserIdMessage {
  accept?: unknown;
}

function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Presença pública de um usuário online (enviada ao cliente nos overlays). */
interface PresencePayload {
  online: true;
  status: string;
  roomId: string;
  roomName: string;
  roomClients: number;
  roomMax: number;
  matchStarted: boolean;
  skinId: string;
}

/**
 * Sala global do sistema Social: presença (quem está online e onde),
 * pedidos de amizade (persistidos no Postgres) e convites de sala.
 * Todo cliente autenticado fica conectado aqui — home, lobby e partida.
 */
export class SocialRoom extends Room<SocialState> {
  private userBySession = new Map<string, number>();
  private sessionsByUser = new Map<number, Set<string>>();
  /** Última skin gravada no banco por usuário (evita UPDATE repetido). */
  private persistedSkin = new Map<number, string>();

  onCreate(): void {
    this.setState(new SocialState());
    // Sala global: não fecha quando esvazia e aceita o servidor inteiro.
    this.autoDispose = false;
    this.maxClients = 1000;

    // O cliente avisa quando já registrou os handlers — só então enviamos
    // as listas (mensagem no onJoin chegaria antes do onMessage do cliente).
    this.onMessage("socialReady", (client) => void this.pushLists(client));

    this.onMessage("presence", (client, msg: PresenceMessage) =>
      this.handlePresence(client, msg)
    );

    this.onMessage("friendRequest", (client, msg: UserIdMessage) => {
      const targetId = typeof msg?.userId === "number" ? msg.userId : 0;
      void this.sendFriendRequest(client, targetId);
    });

    this.onMessage("friendRequestByName", (client, msg: { username?: unknown }) => {
      const username = cleanText(msg?.username, 16);
      if (!username) return;
      void (async () => {
        const target = await social
          .findUserByName(username)
          .catch((err) => this.dbError(client, err));
        if (!target) {
          this.toast(client, `Jogador "${username}" não encontrado.`, true);
          return;
        }
        await this.sendFriendRequest(client, target.id);
      })();
    });

    this.onMessage("friendRespond", (client, msg: RespondMessage) =>
      void this.respondRequest(client, msg)
    );

    this.onMessage("friendRemove", (client, msg: UserIdMessage) => {
      const otherId = typeof msg?.userId === "number" ? msg.userId : 0;
      void this.removeFriend(client, otherId);
    });

    this.onMessage("friendInfo", (client, msg: UserIdMessage) => {
      const targetId = typeof msg?.userId === "number" ? msg.userId : 0;
      void this.sendFriendInfo(client, targetId);
    });

    this.onMessage("invite", (client, msg: UserIdMessage) => {
      const targetId = typeof msg?.userId === "number" ? msg.userId : 0;
      void this.inviteToRoom(client, targetId);
    });
  }

  async onJoin(client: Client, options: { token?: unknown }): Promise<void> {
    if (!isAuthEnabled()) throw new Error("auth_disabled");
    const auth = await authenticateToken(options?.token);
    if (!auth.ok) {
      throw new Error(
        auth.reason === "session_replaced" ? "session_replaced" : "login_required"
      );
    }
    const account = auth.account;

    const userId = account.id;
    bindClient(userId, "social", client);
    this.userBySession.set(client.sessionId, userId);
    let sessions = this.sessionsByUser.get(userId);
    if (!sessions) {
      sessions = new Set();
      this.sessionsByUser.set(userId, sessions);
    }
    sessions.add(client.sessionId);

    const p = new SocialUserState();
    p.userId = userId;
    p.name = account.username;
    p.status = "home";
    p.skinId = await social
      .getStoredSkin(userId)
      .catch(() => "skin_default");
    this.persistedSkin.set(userId, p.skinId);
    this.state.users.set(client.sessionId, p);
  }

  onLeave(client: Client): void {
    const userId = this.userBySession.get(client.sessionId);
    this.userBySession.delete(client.sessionId);
    this.state.users.delete(client.sessionId);
    if (userId !== undefined) {
      unbindClient(userId, client);
      const sessions = this.sessionsByUser.get(userId);
      if (sessions) {
        sessions.delete(client.sessionId);
        if (sessions.size === 0) {
          this.sessionsByUser.delete(userId);
          this.persistedSkin.delete(userId);
        }
      }
    }
  }

  // --- Infra interna ---

  private toast(client: Client, message: string, isError = false): void {
    client.send("socialToast", { message, isError });
  }

  private dbError(client: Client, err: unknown): null {
    console.error("[social] db:", err);
    this.toast(client, "Erro no servidor. Tenta de novo.", true);
    return null;
  }

  /** Todas as conexões (abas) de um usuário online. */
  private clientsOf(userId: number): Client[] {
    const sessions = this.sessionsByUser.get(userId);
    if (!sessions) return [];
    return this.clients.filter((c) => sessions.has(c.sessionId));
  }

  /** Presença pública de um usuário (primeira sessão encontrada). */
  private presenceOf(userId: number): PresencePayload | null {
    const sessions = this.sessionsByUser.get(userId);
    if (!sessions) return null;
    for (const sessionId of sessions) {
      const p = this.state.users.get(sessionId);
      if (p) {
        return {
          online: true,
          status: p.status,
          roomId: p.roomId,
          roomName: p.roomName,
          roomClients: p.roomClients,
          roomMax: p.roomMax,
          matchStarted: p.matchStarted,
          skinId: p.skinId,
        };
      }
    }
    return null;
  }

  /** Envia a lista fresca de amigos + pedidos para UMA conexão. */
  private async pushLists(client: Client): Promise<void> {
    const userId = this.userBySession.get(client.sessionId);
    if (userId === undefined) return;
    try {
      const [friends, requests, outgoing] = await Promise.all([
        social.listFriends(userId),
        social.listRequests(userId),
        social.listOutgoing(userId),
      ]);
      client.send("socialUpdate", { friends, requests, outgoing });
    } catch (err) {
      this.dbError(client, err);
    }
  }

  /** Atualiza a lista em todas as abas do usuário. */
  private async pushListsToUser(userId: number): Promise<void> {
    await Promise.all(this.clientsOf(userId).map((c) => this.pushLists(c)));
  }

  private myId(client: Client): number | null {
    const id = this.userBySession.get(client.sessionId);
    return id === undefined ? null : id;
  }

  // --- Presença ---

  private handlePresence(client: Client, msg: PresenceMessage): void {
    const p = this.state.users.get(client.sessionId);
    if (!p || !msg) return;

    if (typeof msg.status === "string" && VALID_STATUS.has(msg.status)) {
      p.status = msg.status;
    }
    p.roomId = cleanText(msg.roomId, 32);
    p.roomName = cleanText(msg.roomName, 24);
    p.roomClients = clampInt(msg.roomClients, 0, 64);
    p.roomMax = clampInt(msg.roomMax, 0, 64);
    p.matchStarted = msg.matchStarted === true;

    const skinId = cleanText(msg.skinId, 32);
    if (skinId && skinId !== p.skinId) {
      p.skinId = skinId;
      // Grava a skin ativa para exibir amigos offline (uma vez por troca).
      const userId = this.userBySession.get(client.sessionId);
      if (userId !== undefined && this.persistedSkin.get(userId) !== skinId) {
        this.persistedSkin.set(userId, skinId);
        social
          .storeSkin(userId, skinId)
          .catch((err) => console.error("[social] skin:", err));
      }
    }
  }

  // --- Pedidos de amizade ---

  private async sendFriendRequest(client: Client, targetId: number): Promise<void> {
    const myId = this.myId(client);
    const me = this.state.users.get(client.sessionId);
    if (myId === null || !me || !targetId) return;

    try {
      if (targetId === myId) {
        this.toast(client, "Você não pode adicionar a si mesmo.", true);
        return;
      }
      const target = await social.findUserById(targetId);
      if (!target) {
        this.toast(client, "Jogador não encontrado.", true);
        return;
      }
      if (await social.areFriends(myId, targetId)) {
        this.toast(client, `Você e ${target.username} já são amigos.`, true);
        return;
      }

      // Pedido cruzado: o outro já tinha me convidado — aceita na hora.
      if (await social.hasRequest(targetId, myId)) {
        await social.deleteRequest(targetId, myId);
        await social.createFriendship(myId, targetId);
        this.toast(client, `Você e ${target.username} agora são amigos!`);
        for (const c of this.clientsOf(targetId)) {
          this.toast(c, `${me.name} aceitou seu pedido de amizade.`);
        }
        await this.pushListsToUser(myId);
        await this.pushListsToUser(targetId);
        return;
      }

      if (await social.hasRequest(myId, targetId)) {
        this.toast(client, `Pedido já enviado para ${target.username}.`, true);
        return;
      }

      await social.createRequest(myId, targetId);
      this.toast(client, `Pedido de amizade enviado para ${target.username}.`);

      // Notificação em tempo real se o alvo estiver online.
      for (const c of this.clientsOf(targetId)) {
        c.send("socialRequest", { from: { userId: myId, name: me.name } });
      }
      // O remetente também atualiza (pedido vira "pendente" nos menus dele).
      await this.pushListsToUser(myId);
      await this.pushListsToUser(targetId);
    } catch (err) {
      this.dbError(client, err);
    }
  }

  private async respondRequest(client: Client, msg: RespondMessage): Promise<void> {
    const myId = this.myId(client);
    const me = this.state.users.get(client.sessionId);
    const otherId = typeof msg?.userId === "number" ? msg.userId : 0;
    if (myId === null || !me || !otherId) return;

    try {
      if (!(await social.hasRequest(otherId, myId))) {
        this.toast(client, "Esse pedido não existe mais.", true);
        await this.pushLists(client);
        return;
      }
      await social.deleteRequest(otherId, myId);

      const accept = msg?.accept === true;
      if (accept) {
        await social.createFriendship(myId, otherId);
        this.toast(client, "Pedido aceito — vocês agora são amigos!");
        for (const c of this.clientsOf(otherId)) {
          this.toast(c, `${me.name} aceitou seu pedido de amizade.`);
        }
      } else {
        for (const c of this.clientsOf(otherId)) {
          this.toast(c, `${me.name} recusou seu pedido de amizade.`);
        }
      }
      await this.pushListsToUser(myId);
      await this.pushListsToUser(otherId);
    } catch (err) {
      this.dbError(client, err);
    }
  }

  private async removeFriend(client: Client, otherId: number): Promise<void> {
    const myId = this.myId(client);
    const me = this.state.users.get(client.sessionId);
    if (myId === null || !me || !otherId) return;

    try {
      if (!(await social.deleteFriendship(myId, otherId))) return;
      await this.pushListsToUser(myId);
      await this.pushListsToUser(otherId);
      for (const c of this.clientsOf(otherId)) {
        this.toast(c, `${me.name} removeu você da lista de amigos.`);
      }
    } catch (err) {
      this.dbError(client, err);
    }
  }

  // --- Informações públicas do amigo ---

  private async sendFriendInfo(client: Client, targetId: number): Promise<void> {
    if (this.myId(client) === null || !targetId) return;
    try {
      const profile = await social.getPublicProfile(targetId);
      if (!profile) {
        this.toast(client, "Jogador não encontrado.", true);
        return;
      }
      const presence = this.presenceOf(targetId);
      // Online: a skin da presença é a mais fresca (banco pode estar velho).
      if (presence) profile.skin = presence.skinId;
      client.send("socialInfo", { userId: targetId, profile, presence });
    } catch (err) {
      this.dbError(client, err);
    }
  }

  // --- Convite para a sala ---

  private async inviteToRoom(client: Client, targetId: number): Promise<void> {
    const myId = this.myId(client);
    const me = this.state.users.get(client.sessionId);
    if (myId === null || !me || !targetId) return;

    if (!me.roomId) {
      this.toast(client, "Você precisa estar em uma sala para convidar.", true);
      return;
    }
    if (me.roomMax > 0 && me.roomClients >= me.roomMax) {
      this.toast(client, "Sua sala está cheia.", true);
      return;
    }

    try {
      if (!(await social.areFriends(myId, targetId))) {
        this.toast(client, "Você só pode convidar amigos.", true);
        return;
      }
      const targets = this.clientsOf(targetId);
      if (targets.length === 0) {
        this.toast(client, "Esse amigo está offline.", true);
        return;
      }
      const targetState = targets
        .map((c) => this.state.users.get(c.sessionId))
        .find((p) => p !== undefined);
      if (targetState?.roomId === me.roomId) {
        this.toast(client, "Ele já está na sua sala.", true);
        return;
      }
      for (const c of targets) {
        c.send("socialInvite", {
          fromUserId: myId,
          fromName: me.name,
          roomId: me.roomId,
          roomName: me.roomName,
        });
      }
      this.toast(client, `Convite enviado para ${targetState?.name ?? "amigo"}.`);
    } catch (err) {
      this.dbError(client, err);
    }
  }
}
