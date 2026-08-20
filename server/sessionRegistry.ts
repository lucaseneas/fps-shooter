import type { Client } from "colyseus";

/** Código Colyseus ao expulsar sessão duplicada / login noutro lugar. */
export const SESSION_REPLACED_LEAVE_CODE = 4001;

const SESSION_REPLACED_MSG =
  "Você foi desconectado porque entrou em outro dispositivo.";

interface SessionBinding {
  kind: "social" | "deathmatch";
  client: Client;
}

/** userId → conexões Colyseus ativas (social + partida). */
const byUser = new Map<number, Set<SessionBinding>>();

function notifySessionReplaced(client: Client): void {
  try {
    client.send("sessionReplaced", { message: SESSION_REPLACED_MSG });
  } catch {
    /* socket já fechado */
  }
}

/** Regista ligação; expulsa só duplicatas do mesmo tipo (social+partida podem coexistir). */
export function bindClient(
  userId: number,
  kind: SessionBinding["kind"],
  client: Client
): void {
  let set = byUser.get(userId);
  if (!set) {
    set = new Set();
    byUser.set(userId, set);
  }
  for (const b of [...set]) {
    if (b.kind !== kind || b.client === client) continue;
    notifySessionReplaced(b.client);
    void b.client.leave(SESSION_REPLACED_LEAVE_CODE);
    set.delete(b);
  }
  set.add({ kind, client });
}

export function unbindClient(userId: number, client: Client): void {
  const set = byUser.get(userId);
  if (!set) return;
  for (const b of set) {
    if (b.client === client) set.delete(b);
  }
  if (set.size === 0) byUser.delete(userId);
}

/** Expulsa todas as ligações activas (chamado no login). Devolve true se havia alguma. */
export function disconnectAllForUser(userId: number): boolean {
  const set = byUser.get(userId);
  if (!set || set.size === 0) return false;
  for (const b of [...set]) {
    notifySessionReplaced(b.client);
    void b.client.leave(SESSION_REPLACED_LEAVE_CODE);
  }
  byUser.delete(userId);
  return true;
}
