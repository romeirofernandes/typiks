const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:8787";

/**
 * Provision (or update) the current user's profile via POST /api/users.
 * The server creates a new profile for a first-time uid, returns the
 * existing profile otherwise, and reconciles the stored email when a guest
 * has been upgraded to a permanent account.
 *
 * Pass `forceRefresh: true` after Firebase credential linking so the ID
 * token carries the newly attached email claim; otherwise the cached token
 * still describes the anonymous account and the server cannot detect the
 * upgrade.
 */
export async function createOrGetUser(user, { body = {}, forceRefresh = false } = {}) {
  const idToken = await user.getIdToken(forceRefresh);
  const response = await fetch(`${SERVER_URL}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}
