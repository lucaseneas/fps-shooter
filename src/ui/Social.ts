/** Painel Social: amigos, pedidos, convites, context menus e notificações. */

import { SkinPreview } from "./SkinPreview";
import { rankProgress, rankIconUrl } from "../../shared/ranks";
import {
  FriendEntry,
  FriendProfile,
  InvitePayload,
  PresenceInfo,
  connectSocial,
  disconnectSocial,
  inviteFriend,
  isSocialConnected,
  presenceFor,
  refreshSocialLists,
  removeFriend,
  requestFriend,
  requestFriendByName,
  requestFriendInfo,
  respondFriendRequest,
} from "../net/socialClient";

/** Info da MINHA sala (para habilitar "Convidar jogador"). */
export interface MyRoomInfo {
  roomId: string;
  roomName: string;
  humans: number;
  maxPlayers: number;
}

export interface SocialHooks {
  isLoggedIn(): boolean;
  /** Sessão expulsa — não reconectar. */
  onSessionReplaced(message: string): void;
  /** Entra na sala de um amigo (saindo da atual, se houver). */
  joinRoom(roomId: string): void;
  myRoom(): MyRoomInfo | null;
  /** Chamado quando a conexão social fica pronta (enviar presença). */
  onConnected(): void;
  /** Pedidos de amizade em tempo real só viram toast fora da partida. */
  canShowSocialToasts(): boolean;
}

interface CtxItem {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
}

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

/** Intervalo do watchdog que ressincroniza as listas e detecta socket morto. */
const WATCHDOG_MS = 15000;

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Membro desde ${d.toLocaleDateString("pt-BR")}`;
}

function presenceText(p: PresenceInfo | null): string {
  if (!p) return "Offline";
  if (p.status === "playing") {
    return p.roomName ? `Em partida · ${p.roomName}` : "Em partida";
  }
  if (p.status === "lobby") {
    return p.roomName ? `No lobby · ${p.roomName}` : "No lobby";
  }
  return "Online no menu";
}

export class SocialPanel {
  private hooks: SocialHooks;

  private friends: FriendEntry[] = [];
  private requests: FriendEntry[] = [];
  private outgoing = new Set<number>();
  private lastInfoRequest = 0;
  private friendPreview: SkinPreview | null = null;
  private reconnectTimer = 0;
  /** True enquanto um pedido de listas do watchdog aguarda resposta. */
  private awaitingLists = false;
  /** Assinatura das últimas listas — evita re-render sem mudança. */
  private lastListsSig = "";
  /** Pedidos que chegaram durante a partida — toast ao voltar ao menu. */
  private deferredRequests: Array<{ userId: number; name: string }> = [];
  /** Amigos que ficaram online durante a partida — toast ao voltar ao menu. */
  private deferredOnlineFriends: Array<{ userId: number; name: string }> = [];
  /** Snapshot da última presença conhecida (evita toast na conexão inicial). */
  private previouslyOnlineFriends = new Set<number>();
  private presenceBaselineReady = false;

  constructor(hooks: SocialHooks) {
    this.hooks = hooks;

    $("socialButton").addEventListener("click", () => this.open());
    $("lobbySocialButton").addEventListener("click", () => this.open());
    $("socialCloseButton").addEventListener("click", () => this.close());
    $("socialModal").addEventListener("click", (e) => {
      if (e.target === $("socialModal")) this.close();
    });

    $("socialAddButton").addEventListener("click", () => this.openAddFriend());
    $("addFriendCancel").addEventListener("click", () => this.closeAddFriend());
    $("addFriendModal").addEventListener("click", (e) => {
      if (e.target === $("addFriendModal")) this.closeAddFriend();
    });
    $("addFriendForm").addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitAddFriend();
    });

    $("friendInfoClose").addEventListener("click", () => this.closeFriendInfo());
    $("friendInfoModal").addEventListener("click", (e) => {
      if (e.target === $("friendInfoModal")) this.closeFriendInfo();
    });

    // Context menu global: fecha ao clicar fora / rolar / redimensionar.
    document.addEventListener("mousedown", (e) => {
      const menu = $("contextMenu");
      if (!menu.classList.contains("hidden") && !menu.contains(e.target as Node)) {
        this.hideContextMenu();
      }
    });
    window.addEventListener("blur", () => this.hideContextMenu());
    window.addEventListener("resize", () => this.hideContextMenu());
    document.addEventListener("scroll", () => this.hideContextMenu(), true);
    // ESC é tratado pelo handler central do main.ts (chama handleEscape).

    // Watchdog: ressincroniza as listas periodicamente. Se uma mensagem em
    // tempo real se perder (aba suspensa, socket meio-morto, restart do
    // servidor), a lista se cura sozinha sem precisar dar refresh na página.
    window.setInterval(() => this.tickSocialWatchdog(), WATCHDOG_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.tickSocialWatchdog();
    });
    window.addEventListener("focus", () => this.tickSocialWatchdog());
  }

  /**
   * Pede as listas ao servidor. Se o pedido anterior ficou sem resposta,
   * o socket está provavelmente morto: derruba e reconecta.
   */
  private tickSocialWatchdog(): void {
    if (!this.hooks.isLoggedIn()) return;
    if (!isSocialConnected()) {
      void this.connect();
      return;
    }
    if (this.awaitingLists) {
      this.awaitingLists = false;
      disconnectSocial();
      void this.connect();
      return;
    }
    this.awaitingLists = true;
    refreshSocialLists();
  }

  // --- Conexão ---

  /** Conecta na sala social (chamado ao entrar na home). Idempotente. */
  async connect(): Promise<boolean> {
    if (!this.hooks.isLoggedIn()) return false;
    const ok = await connectSocial({
      onLists: (friends, requests, outgoing) => {
        this.awaitingLists = false;
        const sig = JSON.stringify([friends, requests, outgoing]);
        const changed = sig !== this.lastListsSig;
        this.lastListsSig = sig;
        this.friends = friends;
        this.requests = requests;
        this.outgoing = new Set(outgoing.map((o) => o.userId));
        // Quem já está online na lista não deve gerar toast de "entrou online".
        for (const friend of friends) {
          if (presenceFor(friend.userId)) {
            this.previouslyOnlineFriends.add(friend.userId);
          }
        }
        this.updateBadges();
        if (changed) this.render();
      },
      onRequest: (from) => this.handleIncomingRequest(from),
      onInvite: (invite) => this.pushInviteCard(invite),
      onToast: (message, isError) => this.toast(message, isError),
      onInfo: (userId, profile, presence) => {
        if (userId === this.lastInfoRequest) {
          this.showFriendInfo(profile, presence);
        }
      },
      onPresence: () => {
        this.handlePresenceChange();
        this.render();
      },
      onSessionReplaced: (message) => this.hooks.onSessionReplaced(message),
      onDisconnect: () => {
        // Reconecta sozinho se o painel estiver em uso.
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          if (this.hooks.isLoggedIn()) void this.connect();
        }, 2500);
        this.render();
      },
    });
    if (ok) {
      this.hooks.onConnected();
    } else if (this.hooks.isLoggedIn()) {
      // Servidor inalcançável: tenta de novo em alguns segundos.
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => void this.connect(), 4000);
    }
    this.render();
    return ok;
  }

  disconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    disconnectSocial();
    this.friends = [];
    this.requests = [];
    this.outgoing.clear();
    this.awaitingLists = false;
    this.lastListsSig = "";
    this.deferredOnlineFriends = [];
    this.previouslyOnlineFriends.clear();
    this.presenceBaselineReady = false;
    this.updateBadges();
    this.close();
  }

  // --- Painel ---

  open(): void {
    $("socialModal").classList.remove("hidden");
    if (this.hooks.isLoggedIn()) {
      void this.connect();
      // Já conectado: força um refresh das listas ao abrir o painel.
      if (isSocialConnected()) refreshSocialLists();
    }
    this.render();
  }

  close(): void {
    $("socialModal").classList.add("hidden");
    this.closeAddFriend();
    this.hideContextMenu();
  }

  /** Fecha menus/modais soltos (placar da partida, ESC). */
  dismissPopovers(): void {
    this.hideContextMenu();
    this.closeFriendInfo();
    this.closeAddFriend();
  }

  /**
   * Mostra os pedidos de amizade que chegaram durante a partida.
   * Chamado ao voltar ao lobby/menu.
   */
  flushDeferredRequests(): void {
    if (!this.hooks.canShowSocialToasts()) return;
    const pending = this.deferredRequests.splice(0);
    for (const from of pending) this.pushRequestCard(from);
    const online = this.deferredOnlineFriends.splice(0);
    for (const friend of online) this.pushFriendOnlineToast(friend);
  }

  /** Fecha o que estiver aberto por cima. Retorna true se fechou algo. */
  handleEscape(): boolean {
    if (!$("contextMenu").classList.contains("hidden")) {
      this.hideContextMenu();
      return true;
    }
    if (!$("addFriendModal").classList.contains("hidden")) {
      this.closeAddFriend();
      return true;
    }
    if (!$("friendInfoModal").classList.contains("hidden")) {
      this.closeFriendInfo();
      return true;
    }
    if (!$("socialModal").classList.contains("hidden")) {
      this.close();
      return true;
    }
    return false;
  }

  private updateBadges(): void {
    const count = this.requests.length;
    for (const id of ["socialBadge", "lobbySocialBadge"]) {
      const badge = $(id);
      badge.textContent = String(count);
      badge.classList.toggle("hidden", count === 0);
    }
  }

  private render(): void {
    const modal = $("socialModal");
    if (modal.classList.contains("hidden")) return;

    const loggedIn = this.hooks.isLoggedIn();
    $("socialGuest").classList.toggle("hidden", loggedIn);
    $("socialContent").classList.toggle("hidden", !loggedIn);
    $("socialAddButton").toggleAttribute("disabled", !loggedIn);
    if (!loggedIn) return;

    this.renderRequests();
    this.renderFriends();
  }

  private renderRequests(): void {
    const section = $("socialRequestsSection");
    const list = $("socialRequestsList");
    section.classList.toggle("hidden", this.requests.length === 0);
    list.innerHTML = "";

    for (const req of this.requests) {
      const row = document.createElement("div");
      row.className = "social-row";

      const rank = rankProgress(req.xp).rank;
      const icon = document.createElement("img");
      icon.className = "lobby-rank";
      icon.src = rankIconUrl(rank);
      icon.alt = rank.name;
      icon.title = rank.name;

      const name = document.createElement("span");
      name.className = "social-row-name";
      name.textContent = req.name;

      const actions = document.createElement("span");
      actions.className = "social-row-actions";

      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "social-mini accept";
      accept.textContent = "Aceitar";
      accept.addEventListener("click", () =>
        respondFriendRequest(req.userId, true)
      );

      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "social-mini decline";
      decline.textContent = "Recusar";
      decline.addEventListener("click", () =>
        respondFriendRequest(req.userId, false)
      );

      actions.append(accept, decline);
      row.append(icon, name, actions);
      list.appendChild(row);
    }
  }

  private renderFriends(): void {
    const list = $("socialFriendsList");
    const count = $("socialFriendsCount");
    list.innerHTML = "";
    count.textContent = this.friends.length > 0 ? String(this.friends.length) : "";

    if (!isSocialConnected()) {
      list.innerHTML = `<p class="no-rooms">Conectando ao Social…</p>`;
      return;
    }
    if (this.friends.length === 0) {
      list.innerHTML = `<p class="no-rooms">Nenhum amigo ainda.<br />Use "Adicionar amigo" ou clique com o botão direito num jogador do lobby.</p>`;
      return;
    }

    // Online primeiro, depois por nome.
    const rows = [...this.friends].sort((a, b) => {
      const pa = presenceFor(a.userId) ? 0 : 1;
      const pb = presenceFor(b.userId) ? 0 : 1;
      return pa - pb || a.name.localeCompare(b.name);
    });

    for (const friend of rows) {
      const presence = presenceFor(friend.userId);
      const row = document.createElement("div");
      row.className = `social-row friend${presence ? "" : " offline"}`;
      row.title = "Clique para ver informações · Botão direito para opções";

      const rank = rankProgress(friend.xp).rank;
      const icon = document.createElement("img");
      icon.className = "lobby-rank";
      icon.src = rankIconUrl(rank);
      icon.alt = rank.name;
      icon.title = rank.name;

      const info = document.createElement("span");
      info.className = "social-row-info";
      const name = document.createElement("span");
      name.className = "social-row-name";
      name.textContent = friend.name;
      const status = document.createElement("span");
      status.className = `social-row-status${presence ? " online" : ""}`;
      status.textContent = presenceText(presence);
      info.append(name, status);

      row.append(icon, info);

      row.addEventListener("click", () => this.openFriendInfo(friend.userId));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.openFriendMenu(friend, e.clientX, e.clientY);
      });

      list.appendChild(row);
    }
  }

  // --- Context menus ---

  private showContextMenu(items: CtxItem[], x: number, y: number): void {
    const menu = $("contextMenu");
    menu.innerHTML = "";

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ctx-item${item.danger ? " danger" : ""}`;
      btn.textContent = item.label;
      btn.disabled = item.disabled === true;
      if (item.action) {
        btn.addEventListener("click", () => {
          this.hideContextMenu();
          item.action!();
        });
      }
      menu.appendChild(btn);
    }

    menu.classList.remove("hidden");
    // Mantém o menu dentro da janela.
    const rect = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, px)}px`;
    menu.style.top = `${Math.max(8, py)}px`;
  }

  private hideContextMenu(): void {
    $("contextMenu").classList.add("hidden");
  }

  /** Botão direito num jogador da lista do pré-lobby. */
  openLobbyPlayerMenu(
    target: { userId: number; name: string; isBot?: boolean },
    x: number,
    y: number
  ): void {
    if (!this.hooks.isLoggedIn()) {
      this.showContextMenu(
        [{ label: "Entre numa conta para adicionar amigos", disabled: true }],
        x,
        y
      );
      return;
    }
    if (!target.userId) {
      this.showContextMenu(
        [
          {
            label: target.isBot
              ? "Bot — não pode receber pedidos"
              : "Convidado — não pode receber pedidos",
            disabled: true,
          },
        ],
        x,
        y
      );
      return;
    }

    const friend = this.friends.find((f) => f.userId === target.userId);
    if (friend) {
      this.openFriendMenu(friend, x, y);
      return;
    }
    if (this.outgoing.has(target.userId)) {
      this.showContextMenu(
        [
          {
            label: "Informações",
            action: () => this.openFriendInfo(target.userId),
          },
          { label: "Pedido de amizade já enviado", disabled: true },
        ],
        x,
        y
      );
      return;
    }
    const incoming = this.requests.find((r) => r.userId === target.userId);
    if (incoming) {
      this.showContextMenu(
        [
          {
            label: "Informações",
            action: () => this.openFriendInfo(target.userId),
          },
          {
            label: "Aceitar pedido de amizade",
            action: () => respondFriendRequest(target.userId, true),
          },
          {
            label: "Recusar pedido",
            danger: true,
            action: () => respondFriendRequest(target.userId, false),
          },
        ],
        x,
        y
      );
      return;
    }

    this.showContextMenu(
      [
        {
          label: "Informações",
          action: () => this.openFriendInfo(target.userId),
        },
        {
          label: "Adicionar como amigo",
          action: () => requestFriend(target.userId),
        },
      ],
      x,
      y
    );
  }

  /** Botão direito num amigo da lista Social. */
  private openFriendMenu(friend: FriendEntry, x: number, y: number): void {
    const presence = presenceFor(friend.userId);
    const myRoom = this.hooks.myRoom();

    // Sala cheia só faz sentido quando o limite é conhecido (roomMax > 0).
    const friendRoomFull =
      presence !== null &&
      presence.roomMax > 0 &&
      presence.roomClients >= presence.roomMax;

    // "Entrar na sala": amigo numa sala (lobby ou partida), com vaga,
    // e não é a minha sala.
    const canJoin =
      presence !== null &&
      presence.roomId !== "" &&
      !friendRoomFull &&
      presence.roomId !== myRoom?.roomId;

    // "Convidar jogador": eu estou numa sala com vaga e o amigo não está nela.
    const canInvite =
      myRoom !== null &&
      myRoom.humans < myRoom.maxPlayers &&
      presence !== null &&
      presence.roomId !== myRoom.roomId;

    const joinHint = !presence
      ? "Entrar na sala (offline)"
      : !presence.roomId
        ? "Entrar na sala (não está em sala)"
        : presence.roomId === myRoom?.roomId
          ? "Entrar na sala (já está na sua sala)"
          : friendRoomFull
            ? "Entrar na sala (sala cheia)"
            : "Entrar na sala";

    const inviteHint = !myRoom
      ? "Convidar jogador (você não está em sala)"
      : myRoom.humans >= myRoom.maxPlayers
        ? "Convidar jogador (sala cheia)"
        : !presence
          ? "Convidar jogador (offline)"
          : "Convidar jogador";

    this.showContextMenu(
      [
        {
          label: "Informações",
          action: () => this.openFriendInfo(friend.userId),
        },
        {
          label: joinHint,
          disabled: !canJoin,
          action: () => this.hooks.joinRoom(presence!.roomId),
        },
        {
          label: inviteHint,
          disabled: !canInvite,
          action: () => inviteFriend(friend.userId),
        },
        {
          label: "Remover amigo",
          danger: true,
          action: () => removeFriend(friend.userId),
        },
      ],
      x,
      y
    );
  }

  // --- Modal "Adicionar amigo" ---

  private openAddFriend(): void {
    if (!this.hooks.isLoggedIn()) return;
    ($("addFriendStatus") as HTMLParagraphElement).textContent = "";
    ($("addFriendInput") as HTMLInputElement).value = "";
    $("addFriendModal").classList.remove("hidden");
    ($("addFriendInput") as HTMLInputElement).focus();
  }

  private closeAddFriend(): void {
    $("addFriendModal").classList.add("hidden");
  }

  private submitAddFriend(): void {
    const input = $("addFriendInput") as HTMLInputElement;
    const username = input.value.trim();
    if (!username) return;
    if (!isSocialConnected()) {
      ($("addFriendStatus") as HTMLParagraphElement).textContent =
        "Sem conexão com o Social — tenta de novo.";
      return;
    }
    requestFriendByName(username);
    this.closeAddFriend();
  }

  // --- Modal "Informações" do amigo ---

  private openFriendInfo(userId: number): void {
    if (!isSocialConnected()) return;
    this.lastInfoRequest = userId;
    requestFriendInfo(userId);
  }

  private showFriendInfo(
    profile: FriendProfile,
    presence: PresenceInfo | null
  ): void {
    $("friendInfoName").textContent = profile.username;
    const meta = [
      presenceText(presence),
      formatMemberSince(profile.createdAt),
    ]
      .filter(Boolean)
      .join(" · ");
    $("friendInfoMeta").textContent = meta;

    const progress = rankProgress(profile.xp);
    const { rank, next } = progress;
    const icon = $("friendInfoRankIcon") as HTMLImageElement;
    icon.src = rankIconUrl(rank);
    icon.alt = rank.name;
    $("friendInfoRankName").textContent = rank.name;
    ($("friendInfoXpFill") as HTMLDivElement).style.width =
      `${Math.round(progress.ratio * 100)}%`;
    $("friendInfoXpText").textContent = next
      ? `${profile.xp} XP · faltam ${next.minXp - profile.xp} para ${next.name}`
      : `${profile.xp} XP · patente máxima`;

    const kd =
      profile.deaths > 0 ? profile.kills / profile.deaths : profile.kills;
    const winRate =
      profile.matches > 0
        ? Math.round((profile.wins / profile.matches) * 100)
        : 0;
    $("friendKills").textContent = String(profile.kills);
    $("friendDeaths").textContent = String(profile.deaths);
    $("friendWins").textContent = String(profile.wins);
    $("friendMatches").textContent = String(profile.matches);
    $("friendKd").textContent = kd.toFixed(2);
    $("friendWinRate").textContent = `${winRate}%`;
    $("friendGold").textContent = String(Math.max(0, Math.floor(profile.gold)));

    $("friendInfoModal").classList.remove("hidden");

    if (!this.friendPreview) {
      this.friendPreview = new SkinPreview(
        $("friendInfoCanvas") as HTMLCanvasElement
      );
    }
    this.friendPreview.setSkin(profile.skin || "skin_default");
    this.friendPreview.setWeapon(null);
    this.friendPreview.start();
    this.friendPreview.resize();
  }

  private closeFriendInfo(): void {
    $("friendInfoModal").classList.add("hidden");
    this.friendPreview?.stop();
  }

  /** Fecha previews 3D extras quando a janela muda de tamanho. */
  resizeFriendPreview(): void {
    if (!$("friendInfoModal").classList.contains("hidden")) {
      this.friendPreview?.resize();
    }
  }

  // --- Notificações ---

  /** Detecta amigos que acabaram de ficar online (transição offline → online). */
  private handlePresenceChange(): void {
    const currentlyOnline = new Set<number>();
    for (const friend of this.friends) {
      if (presenceFor(friend.userId)) currentlyOnline.add(friend.userId);
    }

    if (!this.presenceBaselineReady) {
      this.previouslyOnlineFriends = currentlyOnline;
      this.presenceBaselineReady = true;
      return;
    }

    for (const friend of this.friends) {
      if (
        currentlyOnline.has(friend.userId) &&
        !this.previouslyOnlineFriends.has(friend.userId)
      ) {
        this.notifyFriendOnline(friend);
      }
    }

    this.previouslyOnlineFriends = currentlyOnline;
  }

  private notifyFriendOnline(friend: FriendEntry): void {
    if (this.hooks.canShowSocialToasts()) {
      this.pushFriendOnlineToast(friend);
      return;
    }
    if (!this.deferredOnlineFriends.some((f) => f.userId === friend.userId)) {
      this.deferredOnlineFriends.push({
        userId: friend.userId,
        name: friend.name,
      });
    }
  }

  private pushFriendOnlineToast(friend: { userId: number; name: string }): void {
    this.pushCard({
      title: "Amigo online",
      body: `${friend.name} entrou online.`,
    });
  }

  private pushCard(opts: {
    title: string;
    body: string;
    actions?: Array<{
      label: string;
      primary?: boolean;
      onClick: () => void;
    }>;
    timeoutMs?: number;
    isError?: boolean;
  }): void {
    const container = $("socialNotifications");
    // Limita a pilha: remove a mais antiga.
    while (container.childElementCount >= 5) {
      container.firstElementChild?.remove();
    }

    const card = document.createElement("div");
    card.className = `social-toast${opts.isError ? " error" : ""}`;

    const title = document.createElement("p");
    title.className = "social-toast-title";
    title.textContent = opts.title;
    const body = document.createElement("p");
    body.className = "social-toast-body";
    body.textContent = opts.body;
    card.append(title, body);

    const dismiss = () => card.remove();

    if (opts.actions?.length) {
      const actions = document.createElement("div");
      actions.className = "social-toast-actions";
      for (const a of opts.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = a.primary ? "primary" : "";
        btn.textContent = a.label;
        btn.addEventListener("click", () => {
          dismiss();
          a.onClick();
        });
        actions.appendChild(btn);
      }
      card.appendChild(actions);
    }

    container.appendChild(card);
    window.setTimeout(dismiss, opts.timeoutMs ?? (opts.actions ? 30000 : 4500));
  }

  private handleIncomingRequest(from: { userId: number; name: string }): void {
    if (this.hooks.canShowSocialToasts()) {
      this.pushRequestCard(from);
      return;
    }
    if (!this.deferredRequests.some((r) => r.userId === from.userId)) {
      this.deferredRequests.push(from);
    }
  }

  private pushRequestCard(from: { userId: number; name: string }): void {
    this.pushCard({
      title: "Pedido de amizade",
      body: `${from.name} quer ser seu amigo.`,
      actions: [
        {
          label: "Aceitar",
          primary: true,
          onClick: () => respondFriendRequest(from.userId, true),
        },
        {
          label: "Recusar",
          onClick: () => respondFriendRequest(from.userId, false),
        },
      ],
    });
  }

  private pushInviteCard(invite: InvitePayload): void {
    this.pushCard({
      title: "Convite de partida",
      body: `${invite.fromName} convidou você para a sala ${invite.roomName}.`,
      actions: [
        {
          label: "Entrar",
          primary: true,
          onClick: () => this.hooks.joinRoom(invite.roomId),
        },
        { label: "Recusar", onClick: () => {} },
      ],
    });
  }

  private toast(message: string, isError: boolean): void {
    this.pushCard({ title: "Social", body: message, isError });
  }
}
