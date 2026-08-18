import { useAuth } from "@/hooks/useAuth";
import { useStats } from "@/hooks/useStats";
import { useActivity } from "@/hooks/useActivity";
import { m, useReducedMotion } from "framer-motion";
import { usePlayerPreferences } from "@/hooks/usePlayerPreferences";
import { TypeGraph } from "@/components/charts/TypeGraph";
import GuestUpgradePrompt from "@/components/auth/GuestUpgradePrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getSubmitKeyOptionById,
  NEXT_WORD_CONDITIONS,
  savePlayerPreferences,
  SUBMIT_KEY_OPTIONS,
} from "@/lib/player-preferences";
import { COUNTRIES } from "@/lib/countries";
import { useEffect, useMemo, useState } from "react";
import {
  RATING_TIERS,
  getTierByRating,
} from "@/lib/player-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { userKeys } from "@/lib/query-keys";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { Check as CheckIcon, X as XIcon } from "lucide-react";

const PROFILE_GRAPH_DAYS = 364;
const UNSET_OPTION_VALUE = "__unset__";

function useProfileSettings() {
  const { state: { currentUser } } = useAuth();
  const queryClient = useQueryClient();
  const [isLocationEditing, setIsLocationEditing] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [playerPreferences, setPlayerPreferences] = usePlayerPreferences();
  const [isUsernameDialogOpen, setIsUsernameDialogOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [showConnectAccount, setShowConnectAccount] = useState(false);

  const { stats } = useStats();
  const profileStats = useMemo(
    () => ({
      username: stats?.username ?? "",
      rating: Number.isFinite(Number(stats?.rating)) ? Number(stats.rating) : 800,
      gamesPlayed: Number.isFinite(Number(stats?.gamesPlayed))
        ? Number(stats.gamesPlayed)
        : 0,
      gamesWon: Number.isFinite(Number(stats?.gamesWon)) ? Number(stats.gamesWon) : 0,
      winRate: Number.isFinite(Number(stats?.winRate)) ? Number(stats.winRate) : 0,
    }),
    [stats]
  );

  const draftIsValid =
    /^[a-z0-9._-]+$/i.test(usernameDraft.trim()) &&
    usernameDraft.trim().length >= 3 &&
    usernameDraft.trim().length <= 24;

  useEffect(() => {
    const timerId = setTimeout(() => {
      const value = usernameDraft.trim().toLowerCase();
      setDebouncedUsername(draftIsValid ? value : "");
    }, 350);
    return () => clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameDraft]);

  const { activity: activityData, maxCount } = useActivity(PROFILE_GRAPH_DAYS);

  const locationQuery = useQuery({
    queryKey: userKeys.location(currentUser?.uid),
    queryFn: () =>
      apiFetch(currentUser, `/api/users/${currentUser.uid}/location`).then(
        ({ data }) => ({ country: data?.country || "" })
      ),
    enabled: Boolean(currentUser),
    staleTime: 5 * 60 * 1000,
  });

  const userQuery = useQuery({
    queryKey: userKeys.detail(currentUser?.uid),
    queryFn: () =>
      apiFetch(currentUser, `/api/users/${currentUser.uid}`).then(
        ({ data }) => data?.user || {}
      ),
    enabled: Boolean(currentUser),
    staleTime: 5 * 60 * 1000,
  });

  const username =
    profileStats.username ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";

  const usernameAvailabilityQuery = useQuery({
    queryKey: userKeys.usernameAvailable(debouncedUsername),
    queryFn: () =>
      apiFetch(
        currentUser,
        `/api/users/username/available?username=${encodeURIComponent(debouncedUsername)}`
      ).then(({ data }) => data),
    enabled:
      Boolean(currentUser) &&
      Boolean(debouncedUsername) &&
      debouncedUsername.toLowerCase() !== username.trim().toLowerCase(),
    staleTime: 15 * 1000,
  });

  const usernameAvailability =
    usernameDraft.trim().length === 0 ||
    usernameDraft.trim().toLowerCase() === username.trim().toLowerCase()
      ? "idle"
      : !draftIsValid
      ? "invalid"
      : usernameDraft.trim().toLowerCase() !== debouncedUsername
      ? "checking"
      : usernameAvailabilityQuery.isFetching
      ? "checking"
      : usernameAvailabilityQuery.data?.available
      ? "available"
      : "taken";
  const submitKeyIds = Array.isArray(playerPreferences.submitKeyIds)
    ? playerPreferences.submitKeyIds
    : [playerPreferences.submitKeyId].filter(Boolean);
  const submitKeyOne = submitKeyIds[0] || "enter";
  const submitKeyTwo = submitKeyIds[1] || UNSET_OPTION_VALUE;
  const currentTier = getTierByRating(profileStats.rating);
  const currentTierIndex = RATING_TIERS.findIndex((tier) => tier.label === currentTier.label);
  const nextTier = currentTierIndex > 0 ? RATING_TIERS[currentTierIndex - 1] : null;
  const tierProgressPercent = nextTier
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((Number(profileStats.rating) - currentTier.min) /
              (nextTier.min - currentTier.min)) *
              100
          )
        )
      )
    : 100;

  useEffect(() => {
    const country = locationQuery.data?.country || "";
    setPlayerPreferences((prev) =>
      prev.country === country
        ? prev
        : savePlayerPreferences({ ...prev, country })
    );
  }, [locationQuery.data, setPlayerPreferences]);

  useEffect(() => {
    if (!userQuery.data) return;
    const apiCondition = userQuery.data.nextWordCondition;
    if (
      apiCondition === NEXT_WORD_CONDITIONS.auto ||
      apiCondition === NEXT_WORD_CONDITIONS.manual
    ) {
      setPlayerPreferences((prev) =>
        prev.nextWordCondition === apiCondition
          ? prev
          : savePlayerPreferences({ ...prev, nextWordCondition: apiCondition })
      );
    }
  }, [userQuery.data, setPlayerPreferences]);

  const persistLocationMutation = useMutation({
    mutationFn: (country) =>
      apiFetch(currentUser, `/api/users/${currentUser.uid}/location`, {
        method: "PATCH",
        body: { country: country || null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userKeys.location(currentUser?.uid),
      });
      queryClient.invalidateQueries({
        queryKey: userKeys.detail(currentUser?.uid),
      });
    },
  });

  const persistLocation = async (country) => {
    if (!currentUser || !(locationQuery.isSuccess || locationQuery.isError)) return false;

    try {
      await persistLocationMutation.mutateAsync(country);
      return true;
    } catch (error) {
      console.error("Failed to persist location:", error);
      return false;
    }
  };

  const persistPreferenceMutation = useMutation({
    mutationFn: ({ field, value }) =>
      apiFetch(currentUser, `/api/users/${currentUser.uid}/preferences`, {
        method: "PATCH",
        body: { [field]: value },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userKeys.detail(currentUser?.uid),
      });
    },
  });

  const updatePreference = (field, value) => {
    setPlayerPreferences((prev) => {
      const normalizedValue = value === UNSET_OPTION_VALUE ? "" : value;
      const next = savePlayerPreferences({
        ...prev,
        [field]: normalizedValue,
      });
      return next;
    });

    if (field === "nextWordCondition" && currentUser) {
      void persistPreferenceMutation
        .mutateAsync({ field, value })
        .catch(() => {
          // optimistic local update persists on next render; failure leaves the local value
        });
    }
  };

  const updateSubmitKey = (index, value) => {
    const normalizedValue = value === UNSET_OPTION_VALUE ? null : value;

    setPlayerPreferences((prev) => {
      const currentIds = Array.isArray(prev.submitKeyIds)
        ? prev.submitKeyIds
        : [prev.submitKeyId].filter(Boolean);

      const draft = [currentIds[0] || "enter", currentIds[1] || null];

      if (index === 0) {
        draft[0] = normalizedValue || "enter";
        if (draft[1] === draft[0]) {
          draft[1] = null;
        }
      } else {
        draft[1] = normalizedValue;
        if (draft[1] && draft[1] === draft[0]) {
          draft[1] = null;
        }
      }

      const nextSubmitKeyIds = draft.filter(Boolean);
      const next = savePlayerPreferences({
        ...prev,
        submitKeyIds: nextSubmitKeyIds,
      });
      return next;
    });
  };

  const handleCountryChange = (value) => {
    setPlayerPreferences((prev) => {
      const next = savePlayerPreferences({
        ...prev,
        country: value,
      });
      return next;
    });
  };

  const handleSaveLocation = async () => {
    setIsSavingLocation(true);
    await persistLocation(playerPreferences.country);
    setIsSavingLocation(false);
    setIsLocationEditing(false);
  };

  const handleSaveUsername = async () => {
    if (!currentUser) return;

    const value = usernameDraft.trim();
    if (value.length < 3 || value.length > 24) {
      setUsernameError("Username must be 3-24 characters long.");
      return;
    }
    if (!/^[a-z0-9._-]+$/i.test(value)) {
      setUsernameError(
        "Username can only contain letters, numbers, dots, dashes or underscores."
      );
      return;
    }

    setIsSavingUsername(true);
    setUsernameError("");

    try {
      const { data } = await apiFetch(
        currentUser,
        `/api/users/${currentUser.uid}/username`,
        {
          method: "PATCH",
          body: { username: value },
        }
      );
      queryClient.setQueryData(userKeys.stats(currentUser.uid), (old) =>
        old ? { ...old, username: data.username } : old
      );
      queryClient.invalidateQueries({
        queryKey: userKeys.detail(currentUser.uid),
      });
      setIsUsernameDialogOpen(false);
      setUsernameDraft("");
    } catch (error) {
      if (error?.status === 409) {
        setUsernameError("That username is already taken.");
      } else {
        console.error("Failed to persist username:", error);
        setUsernameError("Could not update your username. Please try again.");
      }
    } finally {
      setIsSavingUsername(false);
    }
  };

  return {
    reducerMotion: useReducedMotion(),
    currentUser,
    username,
    profileStats,
    currentTier,
    nextTier,
    tierProgressPercent,
    playerPreferences,
    submitKeyOne,
    submitKeyTwo,
    activityData,
    maxCount,
    isLocationEditing,
    setIsLocationEditing,
    isSavingLocation,
    handleCountryChange,
    handleSaveLocation,
    isUsernameDialogOpen,
    setIsUsernameDialogOpen,
    usernameDraft,
    setUsernameDraft,
    usernameError,
    setUsernameError,
    usernameAvailability,
    isSavingUsername,
    handleSaveUsername,
    updatePreference,
    updateSubmitKey,
    showConnectAccount,
    setShowConnectAccount,
  };
}

function ProfileHeader({ reduceMotion }) {
  return (
    <m.header
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.06 }}
      className="border-b border-border/70 pb-4"
    >
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Account</p>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Profile</h1>
    </m.header>
  );
}

function ProfileIdentitySection({
  reduceMotion,
  currentUser,
  username,
  setUsernameDraft,
  setUsernameError,
  setIsUsernameDialogOpen,
  setShowConnectAccount,
}) {
  const openUsernameDialog = () => {
    setUsernameDraft(username);
    setUsernameError("");
    setIsUsernameDialogOpen(true);
  };

  return (
    <m.section
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.12 }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="rounded-lg border border-border/70 bg-background/40 p-3">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Username
        </p>
        <div className="mt-1 flex items-center gap-3">
          <UserAvatar
            username={username}
            size="lg"
            plain
            expandOnClick
            className="transition-transform duration-200 hover:scale-105"
          />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <p className="truncate font-sans text-lg font-semibold">{username}</p>
            <Button
              type="button"
              variant="outline"
              onClick={openUsernameDialog}
            >
              Change
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border/70 bg-background/40 p-3">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Email
        </p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="break-all text-sm text-foreground">
            {currentUser?.email || "No email available"}
          </p>
          {!currentUser?.email ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConnectAccount(true)}
            >
              Connect account
            </Button>
          ) : null}
        </div>
      </div>
    </m.section>
  );
}

function ProfileTierSection({
  reduceMotion,
  currentTier,
  nextTier,
  tierProgressPercent,
  profileStats,
}) {
  return (
    <m.section
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18 }}
      className="space-y-4 rounded-lg border border-border/70 bg-background/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Tier Progression
          </p>
          <h2 className="mt-1 text-lg font-semibold">{currentTier.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{currentTier.description}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Rating</p>
          <p className="font-mono text-2xl font-bold tabular-nums">{profileStats.rating}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${tierProgressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{currentTier.min} floor</span>
          <span>
            {nextTier
              ? `${Math.max(0, nextTier.min - Number(profileStats.rating || 0))} to ${nextTier.label}`
              : "Top tier reached"}
          </span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {RATING_TIERS.map((tier) => {
          const active = tier.label === currentTier.label;
          return (
            <Tooltip key={tier.label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? `${tier.color} ring-1 ring-primary/20`
                      : "border-border/70 bg-card/30 hover:bg-card/50"
                  }`}
                >
                  <p className="text-sm font-semibold">{tier.label}</p>
                  <p className="text-xs text-muted-foreground">{tier.min}+</p>
                </button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6} className="max-w-64">
                {tier.description}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </m.section>
  );
}

function ProfileLocationSection({
  reduceMotion,
  playerPreferences,
  handleCountryChange,
  isLocationEditing,
  setIsLocationEditing,
  isSavingLocation,
  handleSaveLocation,
  activityData,
  maxCount,
}) {
  return (
    <m.section
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.24 }}
      className="grid items-stretch gap-6 xl:grid-cols-[minmax(290px,360px)_minmax(0,1fr)]"
    >
      <div className="h-full space-y-5 rounded-lg border border-border/70 bg-background/40 p-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            For The Globe
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="country-select">Country</Label>
            <SearchableSelect
              id="country-select"
              value={playerPreferences.country || ""}
              onValueChange={handleCountryChange}
              options={COUNTRIES.map((c) => ({ value: c, label: c }))}
              placeholder="Select country"
              disabled={!isLocationEditing}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsLocationEditing(true)}
              disabled={isLocationEditing || isSavingLocation}
            >
              Edit
            </Button>
            <Button
              type="button"
              onClick={handleSaveLocation}
              disabled={!isLocationEditing || isSavingLocation}
            >
              {isSavingLocation ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <div className="h-full rounded-lg border border-border/70 bg-background/40 p-4">
        <TypeGraph
          title="Type Graph"
          activityData={activityData}
          maxDailyCount={maxCount}
          days={PROFILE_GRAPH_DAYS}
        />
      </div>
    </m.section>
  );
}

function ProfilePreferencesSection({
  reduceMotion,
  playerPreferences,
  updatePreference,
  submitKeyOne,
  submitKeyTwo,
  updateSubmitKey,
}) {
  return (
    <m.section
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.3 }}
      className="rounded-lg border border-border/70 bg-background/40 p-4"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px]">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="next-word-condition">Next Word Condition</Label>
          <Select
            value={playerPreferences.nextWordCondition}
            onValueChange={(value) =>
              updatePreference("nextWordCondition", value)
            }
          >
            <SelectTrigger id="next-word-condition">
              <SelectValue className="min-w-0 flex-1 truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEXT_WORD_CONDITIONS.manual}>Use submit key</SelectItem>
              <SelectItem value={NEXT_WORD_CONDITIONS.auto}>
                Auto-advance when word is correct
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="submit-key-one">Key 1</Label>
          <Select
            value={submitKeyOne}
            onValueChange={(value) => updateSubmitKey(0, value)}
            disabled={playerPreferences.nextWordCondition !== NEXT_WORD_CONDITIONS.manual}
          >
            <SelectTrigger id="submit-key-one">
              <SelectValue className="min-w-0 flex-1 truncate" />
            </SelectTrigger>
            <SelectContent>
              {SUBMIT_KEY_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="submit-key-two">Key 2</Label>
          <Select
            value={submitKeyTwo}
            onValueChange={(value) => updateSubmitKey(1, value)}
            disabled={playerPreferences.nextWordCondition !== NEXT_WORD_CONDITIONS.manual}
          >
            <SelectTrigger id="submit-key-two">
              <SelectValue placeholder="Not set" className="min-w-0 flex-1 truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET_OPTION_VALUE}>Not set</SelectItem>
              {SUBMIT_KEY_OPTIONS.flatMap((option) =>
                option.id === submitKeyOne
                  ? []
                  : [
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>,
                    ]
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {playerPreferences.nextWordCondition === NEXT_WORD_CONDITIONS.manual && (
        <p className="mt-3 text-xs text-muted-foreground">
          Active submit keys: {getSubmitKeyOptionById(submitKeyOne).label}
          {submitKeyTwo !== UNSET_OPTION_VALUE
            ? `, ${getSubmitKeyOptionById(submitKeyTwo).label}`
            : ""}
        </p>
      )}
    </m.section>
  );
}

function UsernameDialog({
  isUsernameDialogOpen,
  setIsUsernameDialogOpen,
  username,
  usernameDraft,
    setUsernameDraft,
    usernameError,
    setUsernameError,
    usernameAvailability,
    isSavingUsername,
    handleSaveUsername,
}) {
  return (
    <AlertDialog open={isUsernameDialogOpen} onOpenChange={setIsUsernameDialogOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Change username</AlertDialogTitle>
        </AlertDialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveUsername();
          }}
          className="space-y-3"
        >
          <div className="flex justify-center">
            <UserAvatar username={usernameDraft.trim() || username} size="xl" plain />
          </div>
          <div className="space-y-1">
            <div className="relative">
              <Input
                id="profile-username"
                type="text"
                value={usernameDraft}
                onChange={(e) => {
                  setUsernameDraft(e.target.value);
                  setUsernameError("");
                }}
                minLength={3}
                maxLength={24}
                autoComplete="off"
                className={cn(
                  "pr-9",
                  usernameAvailability === "available" &&
                    "border-emerald-500/60 focus-visible:ring-emerald-500/30",
                  (usernameAvailability === "taken" ||
                    usernameAvailability === "invalid") &&
                    "border-destructive/60 focus-visible:ring-destructive/30"
                )}
              />
              {usernameAvailability === "available" ? (
                <CheckIcon
                  size={16}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500"
                />
              ) : usernameAvailability === "taken" ||
                usernameAvailability === "invalid" ? (
                <XIcon
                  size={16}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-destructive"
                />
              ) : usernameAvailability === "checking" ? (
                <span className="absolute right-3 top-1/2 size-3 -translate-y-1/2 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500" />
              ) : null}
            </div>
            {!usernameError && usernameAvailability !== "idle" ? (
              <p
                className={cn(
                  "text-xs",
                  usernameAvailability === "available"
                    ? "text-emerald-500"
                    : usernameAvailability === "checking"
                    ? "text-amber-500"
                    : "text-destructive"
                )}
              >
                {usernameAvailability === "available"
                  ? "Available"
                  : usernameAvailability === "taken"
                  ? "Already taken"
                  : usernameAvailability === "invalid"
                  ? "Not a valid username"
                  : "Checking..."}
              </p>
            ) : null}
          </div>
          {usernameError ? (
            <p className="text-xs text-destructive">{usernameError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSavingUsername}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={isSavingUsername}>
              {isSavingUsername ? "Saving..." : "Save Username"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const Profile = () => {
  const {
    reducerMotion,
    currentUser,
    username,
    profileStats,
    currentTier,
    nextTier,
    tierProgressPercent,
    playerPreferences,
    submitKeyOne,
    submitKeyTwo,
    activityData,
    maxCount,
    isLocationEditing,
    setIsLocationEditing,
    isSavingLocation,
    handleCountryChange,
    handleSaveLocation,
    isUsernameDialogOpen,
    setIsUsernameDialogOpen,
    usernameDraft,
    setUsernameDraft,
    usernameError,
    setUsernameError,
    usernameAvailability,
    isSavingUsername,
    handleSaveUsername,
    updatePreference,
    updateSubmitKey,
    showConnectAccount,
    setShowConnectAccount,
  } = useProfileSettings();

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-full items-start">
      <m.div
        initial={{ opacity: 0, y: reducerMotion ? 0 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full space-y-6"
      >
        <ProfileHeader reduceMotion={reducerMotion} />

        <ProfileIdentitySection
          reduceMotion={reducerMotion}
          currentUser={currentUser}
          username={username}
          setUsernameDraft={setUsernameDraft}
          setUsernameError={setUsernameError}
          setIsUsernameDialogOpen={setIsUsernameDialogOpen}
          setShowConnectAccount={setShowConnectAccount}
        />

        <ProfileTierSection
          reduceMotion={reducerMotion}
          currentTier={currentTier}
          nextTier={nextTier}
          tierProgressPercent={tierProgressPercent}
          profileStats={profileStats}
        />

        <ProfileLocationSection
          reduceMotion={reducerMotion}
          playerPreferences={playerPreferences}
          handleCountryChange={handleCountryChange}
          isLocationEditing={isLocationEditing}
          setIsLocationEditing={setIsLocationEditing}
          isSavingLocation={isSavingLocation}
          handleSaveLocation={handleSaveLocation}
          activityData={activityData}
          maxCount={maxCount}
        />

        <ProfilePreferencesSection
          reduceMotion={reducerMotion}
          playerPreferences={playerPreferences}
          updatePreference={updatePreference}
          submitKeyOne={submitKeyOne}
          submitKeyTwo={submitKeyTwo}
          updateSubmitKey={updateSubmitKey}
        />
      </m.div>
    </div>

        <UsernameDialog
          isUsernameDialogOpen={isUsernameDialogOpen}
          setIsUsernameDialogOpen={setIsUsernameDialogOpen}
          username={username}
          usernameDraft={usernameDraft}
          setUsernameDraft={setUsernameDraft}
          usernameError={usernameError}
          setUsernameError={setUsernameError}
          usernameAvailability={usernameAvailability}
          isSavingUsername={isSavingUsername}
          handleSaveUsername={handleSaveUsername}
        />

        <GuestUpgradePrompt
          open={showConnectAccount}
          onOpenChange={setShowConnectAccount}
        />
    </TooltipProvider>
  );
};

export default Profile;