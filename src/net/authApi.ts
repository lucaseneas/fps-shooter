/** Cliente HTTP para auth (mesmo host do Colyseus). */

import { CONFIG } from "../../shared/config";

export interface AuthUser {
  id: number;
  username: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
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
