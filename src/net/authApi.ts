/** Cliente HTTP para auth (mesmo host do Colyseus). */

import { CONFIG } from "../../shared/config";
import type { ItemType, PlayerInventory } from "../../shared/inventory";

export interface AccountLoadout {
  primary: string;
  secondary: string;
  melee: string;
}

export interface AuthUser {
  id: number;
  username: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
  /** XP de carreira — a patente é derivada dele (shared/ranks). */
  xp: number;
  /** Gold acumulado — moeda de recompensa (shared/gold). */
  gold: number;
  /** Skin ativa persistida na conta. */
  activeSkin: string;
  /** Loadout equipado persistido na conta. */
  loadout: AccountLoadout;
  /** Inventário persistido na conta (skins, armas, futuros itens). */
  inventory: PlayerInventory;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

const TOKEN_KEY = "fps.authToken";

/** Código devolvido pela API quando o login noutro sítio invalidou o token. */
export const AUTH_SESSION_REPLACED = "session_replaced";

export const SESSION_REPLACED_LEAVE_CODE = 4001;

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:${CONFIG.serverPort}`;
  }
  const envUrl = import.meta.env.VITE_SERVER_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  return `${window.location.protocol}//${window.location.hostname}:${CONFIG.serverPort}`;
}

async function api<T>(
  path: string,
  init?: RequestInit
): Promise<
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; code?: string }
> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as T & {
      error?: string;
      code?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error || `Erro ${res.status}`,
        code: data.code,
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: "Servidor offline." };
  }
}

export function loadStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function fetchAuthStatus(): Promise<boolean> {
  const result = await api<{ enabled: boolean }>("/api/auth/status");
  return result.ok ? result.data.enabled : false;
}

export async function registerAccount(
  username: string,
  password: string
): Promise<
  | { ok: true; session: AuthSession; sessionReplaced: boolean }
  | { ok: false; error: string }
> {
  const result = await api<{
    token: string;
    user: AuthUser;
    sessionReplaced?: boolean;
  }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  storeToken(result.data.token);
  return {
    ok: true,
    session: { token: result.data.token, user: result.data.user },
    sessionReplaced: result.data.sessionReplaced === true,
  };
}

export async function loginAccount(
  username: string,
  password: string
): Promise<
  | { ok: true; session: AuthSession; sessionReplaced: boolean }
  | { ok: false; error: string }
> {
  const result = await api<{
    token: string;
    user: AuthUser;
    sessionReplaced?: boolean;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  storeToken(result.data.token);
  return {
    ok: true,
    session: { token: result.data.token, user: result.data.user },
    sessionReplaced: result.data.sessionReplaced === true,
  };
}

export type RestoreSessionResult =
  | { ok: true; session: AuthSession }
  | { ok: false; sessionReplaced: true }
  | { ok: false; sessionReplaced: false };

/** Restaura sessão a partir do token guardado (com stats). */
export async function restoreSession(): Promise<RestoreSessionResult> {
  const token = loadStoredToken();
  if (!token) return { ok: false, sessionReplaced: false };
  const result = await api<{ user: AuthUser }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.ok) {
    clearStoredToken();
    return {
      ok: false,
      sessionReplaced: result.code === AUTH_SESSION_REPLACED,
    };
  }
  return { ok: true, session: { token, user: result.data.user } };
}

/** Atualiza o perfil/stats do utilizador autenticado. */
export async function fetchProfile(): Promise<
  AuthUser | null | "session_replaced"
> {
  const token = loadStoredToken();
  if (!token) return null;
  const result = await api<{ user: AuthUser }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.ok) {
    if (result.code === AUTH_SESSION_REPLACED) return "session_replaced";
    return null;
  }
  return result.data.user;
}

/** Persiste skin ativa + loadout na conta (só com sessão). */
export async function saveAccountPrefs(prefs: {
  activeSkin: string;
  loadout: AccountLoadout;
}): Promise<boolean> {
  const token = loadStoredToken();
  if (!token) return false;
  const result = await api<{ prefs: unknown }>("/api/account/prefs", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(prefs),
  });
  return result.ok;
}

export type BuyItemResult =
  | { ok: true; gold: number; inventory: PlayerInventory }
  | { ok: false; error: string };

/** Compra um item da loja na conta (o servidor valida preço e saldo). */
export async function buyShopItem(
  type: ItemType,
  itemId: string
): Promise<BuyItemResult> {
  const token = loadStoredToken();
  if (!token) return { ok: false, error: "Entre numa conta para comprar." };
  const result = await api<{ gold: number; inventory: PlayerInventory }>(
    "/api/shop/buy",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, itemId }),
    }
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, gold: result.data.gold, inventory: result.data.inventory };
}

/**
 * Une o inventário local ao da conta (login migra skins de convidado).
 * Devolve o inventário merged vindo do servidor, ou null se falhar.
 */
export async function syncAccountInventory(
  inventory: PlayerInventory
): Promise<PlayerInventory | null> {
  const token = loadStoredToken();
  if (!token) return null;
  const result = await api<{ inventory: PlayerInventory }>(
    "/api/inventory/sync",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(inventory),
    }
  );
  return result.ok ? result.data.inventory : null;
}

// --- Skins de arma custom (estúdio in-game) ---

/** Lista as skins custom publicadas no servidor (loja dinâmica). */
export async function fetchCustomWeaponSkins(): Promise<unknown[]> {
  const result = await api<{ skins: unknown[] }>("/api/weapon-skins");
  if (!result.ok || !Array.isArray(result.data.skins)) return [];
  return result.data.skins;
}

export type PublishSkinResult =
  | { ok: true; skin: unknown }
  | { ok: false; error: string };

/** Publica uma skin criada no estúdio (vai direto para a loja). */
export async function publishWeaponSkin(
  def: unknown
): Promise<PublishSkinResult> {
  const result = await api<{ skin: unknown }>("/api/weapon-skins", {
    method: "POST",
    body: JSON.stringify(def),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, skin: result.data.skin };
}

export type DeleteSkinResult = { ok: true } | { ok: false; error: string };

/** Remove uma skin do catálogo global (some da loja). */
export async function deleteWeaponSkin(id: string): Promise<DeleteSkinResult> {
  const result = await api<{ ok: boolean }>("/api/weapon-skins", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

// --- Mapas custom (criador in-game) ---

export async function fetchCustomMaps(): Promise<
  { ok: true; maps: unknown[] } | { ok: false }
> {
  const result = await api<{ maps: unknown[] }>("/api/maps");
  if (!result.ok || !Array.isArray(result.data.maps)) return { ok: false };
  return { ok: true, maps: result.data.maps };
}

export type SaveMapResult =
  | { ok: true; map: unknown }
  | { ok: false; error: string; status: number };

export async function saveCustomMapRemote(
  def: unknown
): Promise<SaveMapResult> {
  const token = loadStoredToken();
  if (!token) return { ok: false, error: "Não autenticado.", status: 401 };
  const result = await api<{ map: unknown }>("/api/maps", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(def),
  });
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, map: result.data.map };
}

export async function deleteCustomMapRemote(
  id: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const token = loadStoredToken();
  if (!token) return { ok: false, error: "Não autenticado.", status: 401 };
  const result = await api<{ ok: boolean }>("/api/maps", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id }),
  });
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true };
}
