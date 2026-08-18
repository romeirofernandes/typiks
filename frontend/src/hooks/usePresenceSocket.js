import { useEffect, useRef } from "react";
import { openWebSocket } from "@/lib/websocket";

const PRESENCE_PING_INTERVAL_MS = 15000;
const PRESENCE_RECONNECT_MS = 2000;

/**
 * Owns the single presence WebSocket for the app: AUTH handshake, PING keepalive,
 * visibility pokes, subscriber tracking, auto-reconnect, and fan-out of
 * PRESENCE_UPDATE / PRESENCE_SNAPSHOT / NOTIFICATION_POKE messages to the rest
 * of the app via window CustomEvents.
 *
 * Subscribers publish intent with `subscribeToPresence(userIds)` (see
 * @/lib/websocket). Consumers listen for `typiks:presence-update` and
 * `typiks:presence-snapshot`. `onNotificationPoke` fires when the server pushes
 * a realtime notification (e.g. a new friend request or room invite).
 */
export function usePresenceSocket({ currentUser, onNotificationPoke }) {
  const presenceSocketRef = useRef(null);
  const presencePingTimerRef = useRef(null);
  const presenceReconnectTimerRef = useRef(null);
  const presenceSubscribersRef = useRef(new Set());
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
      window.dispatchEvent(
        new CustomEvent("typiks:presence-update", {
          detail: { userId, online: Boolean(online) },
        })
      );
    };

    const broadcastPresenceSnapshot = (onlineMap) => {
      if (!onlineMap || typeof onlineMap !== "object") return;
      window.dispatchEvent(
        new CustomEvent("typiks:presence-snapshot", {
          detail: { onlineMap },
        })
      );
    };

    const pushPresenceSubscription = () => {
      sendPresenceMessage({
        type: "SUBSCRIBE",
        userIds: Array.from(presenceSubscribersRef.current),
      });
    };

    const handlePresenceSubscribeEvent = (event) => {
      const ids = Array.isArray(event?.detail?.userIds) ? event.detail.userIds : [];
      let changed = false;

      for (const id of ids) {
        if (typeof id !== "string" || !id) continue;
        if (presenceSubscribersRef.current.has(id)) continue;
        presenceSubscribersRef.current.add(id);
        changed = true;
      }

      if (changed) {
        pushPresenceSubscription();
      }
    };

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
          pushPresenceSubscription();

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
    window.addEventListener("typiks:presence-subscribe", handlePresenceSubscribeEvent);
    onNotificationPokeRef.current?.();

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("typiks:presence-subscribe", handlePresenceSubscribeEvent);
      clearPresenceTimers();
      if (presenceSocketRef.current) {
        try {
          presenceSocketRef.current.close();
        } catch {
          // no-op
        }
        presenceSocketRef.current = null;
      }
    };
  }, [currentUser]);
}