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