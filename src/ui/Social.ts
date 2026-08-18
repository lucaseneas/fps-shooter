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
  /** Entra na sala de um amigo (saindo da atual, se houver). */
  joinRoom(roomId: string): void;
  myRoom(): MyRoomInfo | null;
  /** Chamado quando a conexão social fica pronta (enviar presença). */
  onConnected(): void;
}

interface CtxItem {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
}

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

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
  }

  // --- Conexão ---

  /** Conecta na sala social (chamado ao entrar na home). Idempotente. */
  async connect(): Promise<boolean> {
    if (!this.hooks.isLoggedIn()) return false;
    const ok = await connectSocial({
      onLists: (friends, requests, outgoing) => {
        this.friends = friends;
        this.requests = requests;
        this.outgoing = new Set(outgoing.map((o) => o.userId));
        this.updateBadges();
        this.render();
      },
      onRequest: (from) => this.pushRequestCard(from),
      onInvite: (invite) => this.pushInviteCard(invite),
      onToast: (message, isError) => this.toast(message, isError),
      onInfo: (userId, profile, presence) => {
        if (userId === this.lastInfoRequest) {
          this.showFriendInfo(profile, presence);
        }
      },
      onPresence: () => this.render(),
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
    this.updateBadges();
    this.close();
  }

  // --- Painel ---

  open(): void {
    $("socialModal").classList.remove("hidden");
    if (this.hooks.isLoggedIn()) {
      void this.connect();
    }
    this.render();
  }

  close(): void {
    $("socialModal").classList.add("hidden");
    this.closeAddFriend();
    this.hideContextMenu();
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
    target: { userId: number; name: string },
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
        [{ label: "Convidado — não pode receber pedidos", disabled: true }],
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
        [{ label: "Pedido de amizade já enviado", disabled: true }],
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

    // "Entrar na sala": amigo em partida, com vaga, e não é a minha sala.
    const canJoin =
      presence !== null &&
      presence.roomId !== "" &&
      presence.matchStarted &&
      presence.roomClients < presence.roomMax &&
      presence.roomId !== myRoom?.roomId;

    // "Convidar jogador": eu estou numa sala com vaga e o amigo não está nela.
    const canInvite =
      myRoom !== null &&
      myRoom.humans < myRoom.maxPlayers &&
      presence !== null &&
      presence.roomId !== myRoom.roomId;

    const joinHint = !presence
      ? "Entrar na sala (offline)"
      : !presence.roomId || !presence.matchStarted
        ? "Entrar na sala (não está em partida)"
        : presence.roomClients >= presence.roomMax
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
