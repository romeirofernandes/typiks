import { getServerBaseUrl } from "@/lib/api-client";

/**
 * Public room-status check used by the /join/:code flow. Unlike apiFetch,
 * this endpoint is unauthenticated by design — a link visitor has no token.
 */
export async function fetchRoomStatus(roomCode) {
  const response = await fetch(
    `${getServerBaseUrl()}/api/rooms/${encodeURIComponent(roomCode)}/status`
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return response.json();
}

/**
 * Build the shareable link for a room. Uses VITE_APP_URL when set (so copied
 * links are shareable in every environment), falling back to the current
 * origin for local dev.
 */
export function getRoomLink(roomCode) {
  const base = (import.meta.env.VITE_APP_URL || window.location.origin).replace(
    /\/$/,
    ""
  );
  return `${base}/join/${roomCode}`;
}

export function sanitizeRoomCode(rawCode) {
  if (typeof rawCode !== "string") return "";
  return rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}