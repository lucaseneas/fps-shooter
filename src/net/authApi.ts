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
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error || `Erro ${res.status}`,
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
): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  const result = await api<{ token: string; user: AuthUser }>(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }
  );
  if (!result.ok) return { ok: false, error: result.error };
  storeToken(result.data.token);
  return {
    ok: true,
    session: { token: result.data.token, user: result.data.user },
  };
}

export async function loginAccount(
  username: string,
  password: string
): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  const result = await api<{ token: string; user: AuthUser }>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }
  );
  if (!result.ok) return { ok: false, error: result.error };
  storeToken(result.data.token);
  return {
    ok: true,
    session: { token: result.data.token, user: result.data.user },
  };
}

/** Restaura sessão a partir do token guardado (com stats). */
export async function restoreSession(): Promise<AuthSession | null> {
  const token = loadStoredToken();
  if (!token) return null;
  const result = await api<{ user: AuthUser }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.ok) {
    clearStoredToken();
    return null;
  }
  return { token, user: result.data.user };
}

/** Atualiza o perfil/stats do utilizador autenticado. */
export async function fetchProfile(): Promise<AuthUser | null> {
  const token = loadStoredToken();
  if (!token) return null;
  const result = await api<{ user: AuthUser }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.ok) return null;
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
