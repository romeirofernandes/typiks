import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { meKeys, userKeys } from "@/lib/query-keys";

const ACTION_DEBOUNCE_MS = 300;
const FRIENDS_REFRESH_MS = 8000;

export function useFriends(currentUser, { onAcceptInvite } = {}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [feedback, setFeedback] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const presenceRef = useRef({ online: new Map() });
  const sendRequestDebounceRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    searchInputRef.current = username.trim().toLowerCase();
    if (searchInputRef.current.length < 2) {
      setDebouncedSearch("");
      return;
    }
    const timerId = setTimeout(() => {
      setDebouncedSearch(searchInputRef.current);
    }, ACTION_DEBOUNCE_MS);
    return () => clearTimeout(timerId);
  }, [username]);

  const friendsQuery = useQuery({
    queryKey: meKeys.friends(),
    queryFn: () =>
      apiFetch(currentUser, "/api/users/me/friends").then(
        ({ data }) => (Array.isArray(data.friends) ? data.friends : [])
      ),
    enabled: Boolean(currentUser),
    staleTime: 30 * 1000,
    refetchInterval: FRIENDS_REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const requestsQuery = useQuery({
    queryKey: meKeys.friendRequests(),
    queryFn: async () => {
      const { data } = await apiFetch(currentUser, "/api/users/me/friend-requests");
      return {
        incoming: Array.isArray(data.incoming) ? data.incoming : [],
        outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
      };
    },
    enabled: Boolean(currentUser),
    staleTime: 30 * 1000,
    refetchInterval: FRIENDS_REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const roomInvitesQuery = useQuery({
    queryKey: meKeys.roomInvites(),
    queryFn: () =>
      apiFetch(currentUser, "/api/users/me/room-invites").then(
        ({ data }) =>
          Array.isArray(data.invites)
            ? data.invites.filter((invite) => invite.status === "pending")
            : []
      ),
    enabled: Boolean(currentUser),
    staleTime: 30 * 1000,
    refetchInterval: FRIENDS_REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const friends = useMemo(() => friendsQuery.data ?? [], [friendsQuery.data]);
  const incomingRequests = useMemo(
    () => requestsQuery.data?.incoming ?? [],
    [requestsQuery.data]
  );
  const outgoingRequests = useMemo(
    () => requestsQuery.data?.outgoing ?? [],
    [requestsQuery.data]
  );
  const roomInvites = useMemo(
    () => roomInvitesQuery.data ?? [],
    [roomInvitesQuery.data]
  );

  const loading =
    friendsQuery.isPending || requestsQuery.isPending || roomInvitesQuery.isPending;

  const fetchFriendsData = useCallback(async () => {
    if (!currentUser) return;
    await Promise.all([
      queryClient.refetchQueries({ queryKey: meKeys.friends() }),
      queryClient.refetchQueries({ queryKey: meKeys.friendRequests() }),
      queryClient.refetchQueries({ queryKey: meKeys.roomInvites() }),
    ]);
  }, [currentUser, queryClient]);

  const applyPresence = useCallback(
    (userId, online) => {
      queryClient.setQueryData(meKeys.friends(), (old = []) =>
        old.map((friend) => (friend.id === userId ? { ...friend, online } : friend))
      );
      queryClient.setQueryData(meKeys.friendRequests(), (old = {}) => ({
        incoming: (old?.incoming ?? []).map((request) =>
          request.senderId === userId ? { ...request, senderOnline: online } : request
        ),
        outgoing: (old?.outgoing ?? []).map((request) =>
          request.receiverId === userId ? { ...request, receiverOnline: online } : request
        ),
      }));
      queryClient.setQueryData(meKeys.roomInvites(), (old = []) =>
        old.map((invite) =>
          invite.inviterId === userId ? { ...invite, inviterOnline: online } : invite
        )
      );
    },
    [queryClient]
  );

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

    const onlineMap = presenceRef.current.online;
    friends.forEach((friend) => {
      if (friend.id in onlineMap) applyPresence(friend.id, onlineMap.get(friend.id));
    });
  }, [currentUser, friends, incomingRequests, outgoingRequests, roomInvites, applyPresence]);

  useEffect(() => {
    if (!currentUser) return;

    const onlineMap = presenceRef.current.online;

    const handlePresenceUpdate = (event) => {
      const userId = event?.detail?.userId;
      const online = Boolean(event?.detail?.online);
      if (!userId) return;
      onlineMap.set(userId, online);
      applyPresence(userId, online);
    };

    const handlePresenceSnapshot = (event) => {
      const snapshot = event?.detail?.onlineMap;
      if (!snapshot || typeof snapshot !== "object") return;
      for (const [userId, online] of Object.entries(snapshot)) {
        onlineMap.set(userId, Boolean(online));
        applyPresence(userId, Boolean(online));
      }
    };

    window.addEventListener("typiks:presence-update", handlePresenceUpdate);
    window.addEventListener("typiks:presence-snapshot", handlePresenceSnapshot);

    return () => {
      window.removeEventListener("typiks:presence-update", handlePresenceUpdate);
      window.removeEventListener("typiks:presence-snapshot", handlePresenceSnapshot);
    };
  }, [currentUser, applyPresence]);

  const sendFriendRequestMutation = useMutation({
    mutationFn: (targetUsername) =>
      apiFetch(currentUser, "/api/users/me/friend-requests", {
        method: "POST",
        body: { username: targetUsername.replace(/\s+/g, " ").trim() },
      }).then(({ data }) => data),
    onSuccess: (data) => {
      setUsername("");
      setFeedback(data.message || "Friend request sent.");
      queryClient.invalidateQueries({ queryKey: meKeys.friendRequests() });
      queryClient.invalidateQueries({ queryKey: userKeys.search("") });
    },
    onError: (error) => {
      setFeedback(error.message || "Failed to send friend request.");
    },
  });

  const sendFriendRequest = useCallback(
    async (targetUsername = username) => {
      const normalizedUsername = targetUsername.trim();
      if (!currentUser || !normalizedUsername) return;
      setFeedback("");
      await sendFriendRequestMutation.mutateAsync(normalizedUsername);
    },
    [username, currentUser, sendFriendRequestMutation]
  );

  const debouncedSendFriendRequest = useCallback(() => {
    if (sendFriendRequestMutation.isPending) return;

    if (sendRequestDebounceRef.current) {
      clearTimeout(sendRequestDebounceRef.current);
    }

    sendRequestDebounceRef.current = setTimeout(() => {
      sendFriendRequest();
    }, ACTION_DEBOUNCE_MS);
  }, [sendFriendRequestMutation.isPending, sendFriendRequest]);

  const searchQuery = useQuery({
    queryKey: userKeys.search(debouncedSearch),
    queryFn: () =>
      apiFetch(
        currentUser,
        `/api/users/me/search?query=${encodeURIComponent(debouncedSearch)}`
      ).then(({ data }) => (Array.isArray(data.users) ? data.users : [])),
    enabled: Boolean(currentUser) && debouncedSearch.length >= 2,
    staleTime: 60 * 1000,
  });

  const searchResults = debouncedSearch.length >= 2 ? (searchQuery.data ?? []) : [];
  const searchingUsers = debouncedSearch.length >= 2 && searchQuery.isFetching;

  const respondToRoomInviteMutation = useMutation({
    mutationFn: ({ inviteId, action }) =>
      apiFetch(currentUser, `/api/users/me/room-invites/${inviteId}`, {
        method: "PATCH",
        body: { action },
      }).then(({ data }) => data),
    onSuccess: (data, { action }) => {
      setFeedback(data.message || "Invite updated.");
      queryClient.invalidateQueries({ queryKey: meKeys.roomInvites() });
      if (action === "accept" && data?.invite?.roomCode) {
        onAcceptInvite?.(data.invite.roomCode);
      }
    },
    onError: (error) => {
      setFeedback(error.message || "Failed to respond to room invite.");
    },
  });

  const respondToRequestMutation = useMutation({
    mutationFn: ({ requestId, action }) =>
      apiFetch(currentUser, `/api/users/me/friend-requests/${requestId}`, {
        method: "PATCH",
        body: { action },
      }).then(({ data }) => data),
    onSuccess: (data, { action }) => {
      setFeedback(data.message || "Request updated.");
      queryClient.invalidateQueries({ queryKey: meKeys.friendRequests() });
      if (action === "accept") {
        queryClient.invalidateQueries({ queryKey: meKeys.friends() });
      }
    },
    onError: (error) => {
      setFeedback(error.message || "Failed to update request.");
    },
  });

  const removeFriendMutation = useMutation({
    mutationFn: (friendId) =>
      apiFetch(currentUser, `/api/users/me/friends/${friendId}`, {
        method: "DELETE",
      }).then(({ data }) => data),
    onSuccess: (data) => {
      setFeedback(data.message || "Friend removed.");
      queryClient.invalidateQueries({ queryKey: meKeys.friends() });
      queryClient.invalidateQueries({ queryKey: meKeys.friendRequests() });
    },
    onError: (error) => {
      setFeedback(error.message || "Failed to remove friend.");
    },
  });

  const respondToRoomInvite = async (inviteId, action) => {
    if (!currentUser || !inviteId) return;
    setFeedback("");
    await respondToRoomInviteMutation.mutateAsync({ inviteId, action });
  };

  const respondToRequest = async (requestId, action) => {
    if (!currentUser || !requestId) return;
    setFeedback("");
    await respondToRequestMutation.mutateAsync({ requestId, action });
  };

  const removeFriend = async (friendId) => {
    if (!currentUser || !friendId) return;
    setFeedback("");
    await removeFriendMutation.mutateAsync(friendId);
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
    submitting: sendFriendRequestMutation.isPending,
    fetchFriendsData,
    sendFriendRequest,
    debouncedSendFriendRequest,
    respondToRoomInvite,
    respondToRequest,
    removeFriend,
  };
}