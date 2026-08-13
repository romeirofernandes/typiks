export function getServerBaseUrl() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
  return serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
}

/**
 * Perform an (optionally authenticated) fetch against the Typiks game server.
 *
 * Usage:
 *   apiFetch("/api/users/leaderboard/top")                       // public
 *   apiFetch(idToken, "/api/users/leaderboard/top")              // raw token
 *   apiFetch(currentUser, "/api/users/me/friends")               // Firebase user
 *   apiFetch(currentUser, { path, method, body, headers })       // options bag
 *
 * Resolves a fresh Firebase ID token for `user` if a user object is passed.
 * Throws an Error carrying `status` and `payload` on non-2xx responses.
 */
export async function apiFetch(
  userOrTokenOrPath,
  pathOrOptions,
  maybeOptions
) {
  let user = userOrTokenOrPath;
  let path;
  let options = {};

  if (typeof userOrTokenOrPath === "string") {
    if (typeof pathOrOptions === "string") {
      user = userOrTokenOrPath;
      path = pathOrOptions;
      options = maybeOptions || {};
    } else {
      user = null;
      path = userOrTokenOrPath;
      options = pathOrOptions || {};
    }
  } else if (typeof pathOrOptions === "string") {
    path = pathOrOptions;
    options = maybeOptions || {};
  } else {
    path = pathOrOptions.path;
    options = pathOrOptions;
  }

  let token = null;
  if (typeof user === "string") {
    token = user;
  } else if (user && typeof user.getIdToken === "function") {
    token = await user.getIdToken();
  }

  const response = await fetch(`${getServerBaseUrl()}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return { data: payload };
}