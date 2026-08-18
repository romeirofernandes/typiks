import { useEffect, useRef } from "react";
import { openWebSocket } from "@/lib/websocket";

const PRESENCE_PING_INTERVAL_MS = 15000;
const PRESENCE_RECONNECT_MS = 2000;

// Module-level presence store and subscription registry. No window events —
// consumers register callbacks directly and read state on demand, so the
// presence fan-out is testable without a DOM bridge and cannot leak across
// module instances.
const presenceSubscribers = new Set();
const presenceOnline = new Map();
const updateListeners = new Set();
const snapshotListeners = new Set();
let pushPresenceSubscription = null;

/**
 * Request presence updates for a set of user ids. The ids are merged into a
 * module-level registry and pushed to the shared presence socket (owned by
 * usePresenceSocket) on the next open. Safe to call from anywhere; no-op
 * without ids or before the socket exists (subscriptions are re-pushed on
 * connect).
 */
export function subscribeToPresence(userIds) {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (ids.length === 0) return;

  let changed = false;
  for (const id of ids) {
    if (typeof id !== "string" || !id) continue;
    if (presenceSubscribers.has(id)) continue;
    presenceSubscribers.add(id);
    changed = true;
  }

  if (changed) {
    pushPresenceSubscription?.();
  }
}

/**
 * Subscribe to per-user presence transitions. The listener is called with
 * `(userId, online)` whenever the server reports a change. Returns an
 * unsubscribe function.
 */
export function subscribeToPresenceUpdates(listener) {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/**
 * Subscribe to full presence snapshots (called with the online map the server
 * sends on (re)connect). Returns an unsubscribe function.
 */
export function subscribeToPresenceSnapshots(listener) {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

/**
 * Current known online state, as a Map of userId -> boolean. Sync read for
 * applying presence to freshly loaded lists.
 */
export function getPresenceOnline() {
  return new Map(presenceOnline);
}

/**
 * Owns the single presence WebSocket for the app: AUTH handshake, PING
 * keepalive, visibility pokes, subscriber tracking, auto-reconnect, and
 * fan-out of PRESENCE_UPDATE / PRESENCE_SNAPSHOT messages to the module's
 * subscribers. `onNotificationPoke` fires when the server pushes a realtime
 * notification (e.g. a new friend request or room invite).
 *
 * Consume via `subscribeToPresence(userIds)` and
 * `subscribeToPresenceUpdates` / `subscribeToPresenceSnapshots`.
 */
export function usePresenceSocket({ currentUser, onNotificationPoke }) {
  const presenceSocketRef = useRef(null);
  const presencePingTimerRef = useRef(null);
  const presenceReconnectTimerRef = useRef(null);
  const onNotificationPokeRef = useRef(onNotificationPoke);
  onNotificationPokeRef.current = onNotificationPoke;

  // react-doctor-disable-next-line effect-needs-cleanup -- presence socket + timers are stored in refs and released on unmount below; isMounted guard prevents socket creation after cleanup
  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;

    const clearPresenceTimers = () => {
      if (presencePingTimerRef.current) {
        window.clearInterval(presencePingTimerRef.current);
        presencePingTimerRef.current = null;
      }
      if (presenceReconnectTimerRef.current) {
        window.clearTimeout(presenceReconnectTimerRef.current);
        presenceReconnectTimerRef.current = null;
      }
    };

    const sendPresenceMessage = (payload) => {
      if (!presenceSocketRef.current || presenceSocketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        presenceSocketRef.current.send(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to send presence message:", error);
      }
    };

    const broadcastPresenceUpdate = (userId, online) => {
      if (!userId) return;
      presenceOnline.set(userId, Boolean(online));
      updateListeners.forEach((listener) => listener(userId, Boolean(online)));
    };

    const broadcastPresenceSnapshot = (onlineMap) => {
      if (!onlineMap || typeof onlineMap !== "object") return;
      for (const [userId, online] of Object.entries(onlineMap)) {
        if (userId) presenceOnline.set(userId, Boolean(online));
      }
      snapshotListeners.forEach((listener) => listener(onlineMap));
    };

    const pushSubscriptions = () => {
      sendPresenceMessage({
        type: "SUBSCRIBE",
        userIds: Array.from(presenceSubscribers),
      });
    };

    pushPresenceSubscription = pushSubscriptions;

    const connectPresenceSocket = async () => {
      try {
        const idToken = await currentUser.getIdToken();
        if (!isMounted) return;

        const socket = openWebSocket("/ws/presence");
        presenceSocketRef.current = socket;

        socket.onopen = () => {
          if (!isMounted || presenceSocketRef.current !== socket) return;
          sendPresenceMessage({
            type: "AUTH",
            idToken,
            visible: document.visibilityState === "visible",
          });
          pushSubscriptions();

          clearPresenceTimers();
          presencePingTimerRef.current = window.setInterval(() => {
            sendPresenceMessage({ type: "PING" });
          }, PRESENCE_PING_INTERVAL_MS);
        };

        socket.onclose = () => {
          if (presenceSocketRef.current === socket) {
            presenceSocketRef.current = null;
          }
          if (!isMounted) return;

          clearPresenceTimers();
          presenceReconnectTimerRef.current = window.setTimeout(() => {
            if (!isMounted) return;
            void connectPresenceSocket();
          }, PRESENCE_RECONNECT_MS);
        };

        socket.onerror = () => {
          if (!isMounted) return;
          try {
            socket.close();
          } catch {
            // no-op
          }
        };

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (!payload || typeof payload.type !== "string") return;

            if (payload.type === "PRESENCE_UPDATE") {
              broadcastPresenceUpdate(payload.userId, payload.online);
              return;
            }

            if (payload.type === "PRESENCE_SNAPSHOT") {
              broadcastPresenceSnapshot(payload.onlineMap);
              return;
            }

            if (payload.type === "NOTIFICATION_POKE") {
              onNotificationPokeRef.current?.();
            }
          } catch {
            // no-op
          }
        };
      } catch (error) {
        console.error("Failed to connect presence socket:", error);
      }
    };

    const handleVisibility = () => {
      sendPresenceMessage({
        type: "VISIBILITY",
        visible: document.visibilityState === "visible",
      });
    };

    void connectPresenceSocket();
    document.addEventListener("visibilitychange", handleVisibility);
    onNotificationPokeRef.current?.();

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      clearPresenceTimers();
      if (presenceSocketRef.current) {
        try {
          presenceSocketRef.current.close();
        } catch {
          // no-op
        }
        presenceSocketRef.current = null;
      }
      pushPresenceSubscription = null;
    };
  }, [currentUser]);
}