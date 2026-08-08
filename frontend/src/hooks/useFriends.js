import { useCallback, useEffect, useRef, useState } from "react";

function getServerBaseUrl() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
  return serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
}

const ACTION_DEBOUNCE_MS = 300;

export function useFriends(currentUser, { onAcceptInvite } = {}) {
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [roomInvites, setRoomInvites] = useState([]);
  const [username, setUsername] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sendRequestDebounceRef = useRef(null);
  const searchDebounceRef = useRef(null);

  const fetchFriendsData = useCallback(async () => {
    if (!currentUser) return;

    try {
      setFeedback("");

      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();
      const headers = {
        Authorization: `Bearer ${idToken}`,
      };

      const [friendsRes, requestsRes, roomInvitesRes] = await Promise.all([
        fetch(`${baseUrl}/api/users/me/friends`, { headers }),
        fetch(`${baseUrl}/api/users/me/friend-requests`, { headers }),
        fetch(`${baseUrl}/api/users/me/room-invites`, { headers }),
      ]);

      if (!friendsRes.ok || !requestsRes.ok || !roomInvitesRes.ok) {
        throw new Error("Failed to fetch friends data");
      }

      const friendsData = await friendsRes.json();
      const requestsData = await requestsRes.json();
      const invitesData = await roomInvitesRes.json();

      setFriends(Array.isArray(friendsData.friends) ? friendsData.friends : []);
      setIncomingRequests(Array.isArray(requestsData.incoming) ? requestsData.incoming : []);
      setOutgoingRequests(Array.isArray(requestsData.outgoing) ? requestsData.outgoing : []);
      setRoomInvites(
        Array.isArray(invitesData.invites)
          ? invitesData.invites.filter((invite) => invite.status === "pending")
          : []
      );
    } catch (error) {
      console.error("Failed to load friends:", error);
      setFeedback("Failed to load friends. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchFriendsData();
  }, [fetchFriendsData]);

  useEffect(() => {
    if (!currentUser) return;

    const knownIds = [
      ...friends.map((friend) => friend.id),
      ...incomingRequests.map((request) => request.senderId),
      ...outgoingRequests.map((request) => request.receiverId),
      ...roomInvites.map((invite) => invite.inviterId),
    ].filter(Boolean);

    if (knownIds.length > 0) {
      window.dispatchEvent(
        new CustomEvent("typiks:presence-subscribe", {
          detail: { userIds: knownIds },
        })
      );
    }

    const handlePresenceUpdate = (event) => {
      const userId = event?.detail?.userId;
      const online = Boolean(event?.detail?.online);
      if (!userId) return;

      setFriends((prev) => prev.map((friend) => (friend.id === userId ? { ...friend, online } : friend)));
      setIncomingRequests((prev) =>
        prev.map((request) =>
          request.senderId === userId ? { ...request, senderOnline: online } : request
        )
      );
      setOutgoingRequests((prev) =>
        prev.map((request) =>
          request.receiverId === userId ? { ...request, receiverOnline: online } : request
        )
      );
      setRoomInvites((prev) =>
        prev.map((invite) =>
          invite.inviterId === userId ? { ...invite, inviterOnline: online } : invite
        )
      );
    };

    const handlePresenceSnapshot = (event) => {
      const onlineMap = event?.detail?.onlineMap;
      if (!onlineMap || typeof onlineMap !== "object") return;

      setFriends((prev) =>
        prev.map((friend) =>
          friend.id in onlineMap ? { ...friend, online: Boolean(onlineMap[friend.id]) } : friend
        )
      );
      setIncomingRequests((prev) =>
        prev.map((request) =>
          request.senderId in onlineMap
            ? { ...request, senderOnline: Boolean(onlineMap[request.senderId]) }
            : request
        )
      );
      setOutgoingRequests((prev) =>
        prev.map((request) =>
          request.receiverId in onlineMap
            ? { ...request, receiverOnline: Boolean(onlineMap[request.receiverId]) }
            : request
        )
      );
      setRoomInvites((prev) =>
        prev.map((invite) =>
          invite.inviterId in onlineMap
            ? { ...invite, inviterOnline: Boolean(onlineMap[invite.inviterId]) }
            : invite
        )
      );
    };

    window.addEventListener("typiks:presence-update", handlePresenceUpdate);
    window.addEventListener("typiks:presence-snapshot", handlePresenceSnapshot);

    return () => {
      window.removeEventListener("typiks:presence-update", handlePresenceUpdate);
      window.removeEventListener("typiks:presence-snapshot", handlePresenceSnapshot);
    };
  }, [currentUser, friends, incomingRequests, outgoingRequests, roomInvites]);

  useEffect(() => {
    if (!currentUser) return;

    const refresh = () => {
      fetchFriendsData();
    };

    const timerId = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timerId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [currentUser, fetchFriendsData]);

  const sendFriendRequest = useCallback(
    async (targetUsername = username) => {
      const normalizedUsername = targetUsername.trim();
      if (!currentUser || !normalizedUsername) return;

      try {
        setSubmitting(true);
        setFeedback("");

        const idToken = await currentUser.getIdToken();
        const baseUrl = getServerBaseUrl();

        const response = await fetch(`${baseUrl}/api/users/me/friend-requests`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ username: normalizedUsername }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Could not send friend request");
        }

        setUsername("");
        setFeedback(payload.message || "Friend request sent.");
        await fetchFriendsData();
      } catch (error) {
        setFeedback(error.message || "Failed to send friend request.");
      } finally {
        setSubmitting(false);
      }
    },
    [currentUser, fetchFriendsData, username]
  );

  const searchUsers = useCallback(
    async (query) => {
      const normalizedQuery = query.trim().toLowerCase();
      if (!currentUser || normalizedQuery.length < 2) {
        setSearchResults([]);
        setSearchingUsers(false);
        return;
      }

      try {
        setSearchingUsers(true);

        const idToken = await currentUser.getIdToken();
        const baseUrl = getServerBaseUrl();
        const response = await fetch(
          `${baseUrl}/api/users/me/search?query=${encodeURIComponent(normalizedQuery)}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Failed to search users");
        }

        setSearchResults(Array.isArray(payload.users) ? payload.users : []);
      } catch (error) {
        console.error("Failed to search users:", error);
        setSearchResults([]);
      } finally {
        setSearchingUsers(false);
      }
    },
    [currentUser]
  );

  const debouncedSendFriendRequest = useCallback(() => {
    if (submitting) return;

    if (sendRequestDebounceRef.current) {
      clearTimeout(sendRequestDebounceRef.current);
    }

    sendRequestDebounceRef.current = setTimeout(() => {
      sendFriendRequest();
    }, ACTION_DEBOUNCE_MS);
  }, [sendFriendRequest, submitting]);

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!username.trim()) {
      setSearchResults([]);
      setSearchingUsers(false);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      searchUsers(username);
    }, ACTION_DEBOUNCE_MS);
  }, [searchUsers, username]);

  useEffect(() => {
    return () => {
      if (sendRequestDebounceRef.current) {
        clearTimeout(sendRequestDebounceRef.current);
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const respondToRoomInvite = async (inviteId, action) => {
    if (!currentUser || !inviteId) return;

    try {
      setFeedback("");
      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();

      const response = await fetch(`${baseUrl}/api/users/me/room-invites/${inviteId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to respond to room invite");
      }

      setFeedback(payload.message || "Invite updated.");

      if (action === "accept" && payload?.invite?.roomCode) {
        onAcceptInvite?.(payload.invite.roomCode);
        return;
      }

      await fetchFriendsData();
    } catch (error) {
      setFeedback(error.message || "Failed to respond to room invite.");
    }
  };

  const respondToRequest = async (requestId, action) => {
    if (!currentUser || !requestId) return;

    try {
      setFeedback("");
      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();

      const response = await fetch(`${baseUrl}/api/users/me/friend-requests/${requestId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update request");
      }

      setFeedback(payload.message || "Request updated.");
      await fetchFriendsData();
    } catch (error) {
      setFeedback(error.message || "Failed to update request.");
    }
  };

  const removeFriend = async (friendId) => {
    if (!currentUser || !friendId) return;

    try {
      setFeedback("");
      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();

      const response = await fetch(`${baseUrl}/api/users/me/friends/${friendId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to remove friend");
      }

      setFeedback(payload.message || "Friend removed.");
      await fetchFriendsData();
    } catch (error) {
      setFeedback(error.message || "Failed to remove friend.");
    }
  };

  return {
    loading,
    friends,
    incomingRequests,
    outgoingRequests,
    roomInvites,
    username,
    setUsername,
    searchResults,
    searchingUsers,
    feedback,
    submitting,
    fetchFriendsData,
    sendFriendRequest,
    debouncedSendFriendRequest,
    respondToRoomInvite,
    respondToRequest,
    removeFriend,
  };
}
