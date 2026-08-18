import { getServerBaseUrl } from "@/lib/api-client";

/**
 * Open a WebSocket to the Typiks game server.
 *
 * Accepts an absolute path (e.g. "/ws/game/abc") or pathname and resolves it
 * against the configured server URL, translating http(s) -> ws(s).
 */
export function openWebSocket(path) {
  const wsBaseUrl = getServerBaseUrl()
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:")
    .replace(/\/$/, "");
  return new WebSocket(new URL(path, wsBaseUrl));
}

/**
 * Ask the shared presence socket (owned by usePresenceSocket) to subscribe to
 * a set of user ids. Safe to call from anywhere; no-op without ids.
 */
export function subscribeToPresence(userIds) {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (ids.length === 0) return;
  window.dispatchEvent(
    new CustomEvent("typiks:presence-subscribe", { detail: { userIds: ids } })
  );
}