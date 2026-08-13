export const userKeys = {
  all: ["users"],
  detail: (uid) => [...userKeys.all, uid],
  stats: (uid) => [...userKeys.detail(uid), "stats"],
  activity: (uid, days) => [...userKeys.detail(uid), "activity", days],
  ratingTrend: (uid, modeSeconds) =>
    [...userKeys.detail(uid), "rating-trend", modeSeconds],
  location: (uid) => [...userKeys.detail(uid), "location"],
  search: (query) => [...userKeys.all, "search", query],
};

export const meKeys = {
  all: ["me"],
  profile: () => [...meKeys.all, "profile"],
  friends: () => [...meKeys.all, "friends"],
  friendRequests: () => [...meKeys.all, "friend-requests"],
  roomInvites: () => [...meKeys.all, "room-invites"],
  notifications: () => [...meKeys.all, "notifications"],
};

export const leaderboardKeys = {
  all: ["leaderboard"],
  top: () => [...leaderboardKeys.all, "top"],
};

export const globeKeys = {
  all: ["globe"],
  countryRatings: () => [...globeKeys.all, "countryRatings"],
};