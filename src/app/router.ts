/** Router SPA simples (History API). */

export type AppRoute = "/login" | "/home" | "/play";

type RouteListener = (route: AppRoute) => void;

const listeners = new Set<RouteListener>();

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function currentRoute(): AppRoute {
  const path = normalizePath(window.location.pathname);
  if (path === "/home") return "/home";
  if (path === "/play") return "/play";
  return "/login";
}

export function navigate(route: AppRoute, replace = false): void {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", route);
  notify();
}

export function onRouteChange(fn: RouteListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  const route = currentRoute();
  for (const fn of listeners) fn(route);
}

window.addEventListener("popstate", () => notify());
