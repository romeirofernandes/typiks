import { useAuth } from "@/context/AuthContext";
import { TypeGraph } from "@/components/charts/TypeGraph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
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
import {
  getSubmitKeyOptionById,
  loadPlayerPreferences,
  NEXT_WORD_CONDITIONS,
  savePlayerPreferences,
  SUBMIT_KEY_OPTIONS,
} from "@/lib/player-preferences";
import { ViewIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import {
  FEMALE_AVATAR_IDS,
  MALE_AVATAR_IDS,
  RATING_TIERS,
  getTierByRating,
} from "@/lib/player-meta";

const PROFILE_GRAPH_DAYS = 364;
const UNSET_OPTION_VALUE = "__unset__";
const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_PROFILE_STATS = {
  username: "",
  rating: 800,
  gamesPlayed: 0,
  gamesWon: 0,
  winRate: 0,
  avatarId: "avatar1",
};

const Profile = () => {
  const { currentUser } = useAuth();
  const [activityData, setActivityData] = useState([]);
  const [maxCount, setMaxCount] = useState(0);
  const [countryOptions, setCountryOptions] = useState([]);
  const [countryQuery, setCountryQuery] = useState("");
  const [countryIsTyping, setCountryIsTyping] = useState(false);
  const [isLocationEditing, setIsLocationEditing] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationApiReady, setLocationApiReady] = useState(false);
  const [profileStats, setProfileStats] = useState(DEFAULT_PROFILE_STATS);
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);
  const [pendingAvatarId, setPendingAvatarId] = useState("avatar1");
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [playerPreferences, setPlayerPreferences] = useState(() =>
    loadPlayerPreferences()
  );

  const username =
    profileStats.username ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";
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
    const fetchProfileData = async () => {
      if (!currentUser) return;

      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const [statsResponse, activityResponse, locationResponse, userResponse] = await Promise.all([
          fetch(`${fullUrl}/api/users/${currentUser.uid}/stats`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
          fetch(`${fullUrl}/api/users/${currentUser.uid}/activity?days=${PROFILE_GRAPH_DAYS}`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
          fetch(`${fullUrl}/api/users/${currentUser.uid}/location`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
          fetch(`${fullUrl}/api/users/${currentUser.uid}`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
        ]);

        if (statsResponse.ok) {
          const payload = await statsResponse.json();
          setProfileStats((prev) => ({
            ...prev,
            username: payload?.username || prev.username,
            rating: Number.isFinite(Number(payload?.rating))
              ? Number(payload.rating)
              : prev.rating,
            gamesPlayed: Number.isFinite(Number(payload?.gamesPlayed))
              ? Number(payload.gamesPlayed)
              : prev.gamesPlayed,
            gamesWon: Number.isFinite(Number(payload?.gamesWon))
              ? Number(payload.gamesWon)
              : prev.gamesWon,
            winRate: Number.isFinite(Number(payload?.winRate))
              ? Number(payload.winRate)
              : prev.winRate,
            avatarId: payload?.avatarId || prev.avatarId,
          }));
        }

        if (activityResponse.ok) {
          const payload = await activityResponse.json();
          setActivityData(payload.activity || []);
          setMaxCount(payload.maxCount || 0);
        }

        if (locationResponse?.ok) {
          const payload = await locationResponse.json();
          setPlayerPreferences((prev) =>
            savePlayerPreferences({
              ...prev,
              country: payload.country || "",
            })
          );
          setCountryQuery(payload.country || "");
        }

        if (userResponse?.ok) {
          const payload = await userResponse.json();
          const apiCondition = payload?.user?.nextWordCondition;
          if (apiCondition === NEXT_WORD_CONDITIONS.auto || apiCondition === NEXT_WORD_CONDITIONS.manual) {
            setPlayerPreferences((prev) =>
              savePlayerPreferences({
                ...prev,
                nextWordCondition: apiCondition,
              })
            );
          }

          if (payload?.user?.avatarId) {
            setProfileStats((prev) => ({
              ...prev,
              avatarId: payload.user.avatarId,
            }));
          }
        }

        setLocationApiReady(true);
      } catch (error) {
        console.error("Failed to fetch profile data:", error);
      }
    };

    fetchProfileData();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !locationApiReady || !countryIsTyping) {
      setCountryOptions([]);
      return;
    }

    const query = countryQuery.trim();
    if (query.length === 0) {
      setCountryOptions([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const response = await fetch(
          `${fullUrl}/api/users/locations/countries?query=${encodeURIComponent(query)}&limit=12`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        if (!response.ok) {
          setCountryOptions([]);
          return;
        }

        const payload = await response.json();
        setCountryOptions(Array.isArray(payload.countries) ? payload.countries : []);
      } catch (error) {
        console.error("Failed to fetch countries:", error);
        setCountryOptions([]);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [countryIsTyping, countryQuery, currentUser, locationApiReady]);

  useEffect(() => {
    setPendingAvatarId(profileStats.avatarId || "avatar1");
  }, [profileStats.avatarId]);

  const persistLocation = async (country) => {
    if (!currentUser || !locationApiReady) return false;

    try {
      const idToken = await currentUser.getIdToken();
      const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
      const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

      await fetch(`${fullUrl}/api/users/${currentUser.uid}/location`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          country: country || null,
        }),
      });
      return true;
    } catch (error) {
      console.error("Failed to persist location:", error);
      return false;
    }
  };

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
      void (async () => {
        try {
          const idToken = await currentUser.getIdToken();
          const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
          const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

          await fetch(`${fullUrl}/api/users/${currentUser.uid}/preferences`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ nextWordCondition: value }),
          });
        } catch (error) {
          console.error("Failed to persist next word condition:", error);
        }
      })();
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
    const normalizedCountry = value === UNSET_OPTION_VALUE ? "" : value;

    setPlayerPreferences((prev) => {
      const next = savePlayerPreferences({
        ...prev,
        country: normalizedCountry,
      });
      return next;
    });

    setCountryQuery(normalizedCountry);
    setCountryIsTyping(false);
  };

  const handleSaveLocation = async () => {
    setIsSavingLocation(true);
    await persistLocation(playerPreferences.country);
    setIsSavingLocation(false);
    setIsLocationEditing(false);
    setCountryIsTyping(false);
  };

  const handleSaveAvatar = async () => {
    if (!currentUser || !pendingAvatarId) return;

    const previousAvatar = profileStats.avatarId;
    setIsSavingAvatar(true);
    setProfileStats((prev) => ({ ...prev, avatarId: pendingAvatarId }));

    try {
      const idToken = await currentUser.getIdToken();
      const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
      const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

      const response = await fetch(`${fullUrl}/api/users/${currentUser.uid}/preferences`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ avatarId: pendingAvatarId }),
      });

      if (!response.ok) {
        throw new Error("Failed to save avatar");
      }

      setIsAvatarDialogOpen(false);
    } catch (error) {
      console.error("Failed to persist avatar:", error);
      setProfileStats((prev) => ({ ...prev, avatarId: previousAvatar }));
    } finally {
      setIsSavingAvatar(false);
    }
  };

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-full items-start">
      <div className="w-full space-y-8">
        <header className="space-y-2 border-b border-border/60 pb-5">
          <h1 className="flex items-center gap-2 font-sans text-2xl font-semibold tracking-tight">
            <ViewIcon size={20} />
            Profile
          </h1>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Username
            </p>
            <p className="mt-2 font-sans text-lg font-semibold">{username}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Avatar
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatarId={profileStats.avatarId}
                  username={username}
                  size="lg"
                  expandOnClick
                />
                <p className="text-sm text-muted-foreground">{profileStats.avatarId}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAvatarDialogOpen(true)}
              >
                Change
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Email
            </p>
            <p className="mt-2 break-all text-sm text-foreground">
              {currentUser?.email || "No email available"}
            </p>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border/70 bg-background/40 p-4">
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
                className="h-full rounded-full bg-primary transition-all"
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
        </section>

        <section className="grid items-stretch gap-6 xl:grid-cols-[minmax(290px,360px)_minmax(0,1fr)]">
          <div className="h-full space-y-5 rounded-lg border border-border/70 bg-background/40 p-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                For The Globe
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="country-select">Country</Label>
                <Input
                  id="country-select"
                  value={countryQuery}
                  placeholder="Type country"
                  onChange={(event) => {
                    if (!isLocationEditing) return;
                    setCountryQuery(event.target.value);
                    setCountryIsTyping(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setCountryIsTyping(false), 120);
                  }}
                  disabled={!isLocationEditing}
                />
                {isLocationEditing && countryIsTyping && countryQuery.trim().length > 0 && countryOptions.length > 0 && (
                  <div className="max-h-36 overflow-y-auto rounded-md border border-border/70 bg-background/90 p-1">
                    {countryOptions.map((country) => (
                      <button
                        key={country}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleCountryChange(country)}
                        className="hover:bg-accent hover:text-accent-foreground w-full rounded-sm px-2 py-1 text-left text-sm"
                      >
                        {country}
                      </button>
                    ))}
                  </div>
                )}
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
        </section>

        <section className="rounded-lg border border-border/70 bg-background/40 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px]">
            <div className="space-y-2">
              <Label htmlFor="next-word-condition">Next Word Condition</Label>
              <Select
                value={playerPreferences.nextWordCondition}
                onValueChange={(value) =>
                  updatePreference("nextWordCondition", value)
                }
              >
                <SelectTrigger id="next-word-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEXT_WORD_CONDITIONS.manual}>Use submit key</SelectItem>
                  <SelectItem value={NEXT_WORD_CONDITIONS.auto}>
                    Auto-advance when word is correct
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="submit-key-one">Key 1</Label>
              <Select
                value={submitKeyOne}
                onValueChange={(value) => updateSubmitKey(0, value)}
                disabled={playerPreferences.nextWordCondition !== NEXT_WORD_CONDITIONS.manual}
              >
                <SelectTrigger id="submit-key-one">
                  <SelectValue />
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

            <div className="space-y-2">
              <Label htmlFor="submit-key-two">Key 2</Label>
              <Select
                value={submitKeyTwo}
                onValueChange={(value) => updateSubmitKey(1, value)}
                disabled={playerPreferences.nextWordCondition !== NEXT_WORD_CONDITIONS.manual}
              >
                <SelectTrigger id="submit-key-two">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET_OPTION_VALUE}>Not set</SelectItem>
                  {SUBMIT_KEY_OPTIONS.filter((option) => option.id !== submitKeyOne).map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
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
        </section>

        <AlertDialog open={isAvatarDialogOpen} onOpenChange={setIsAvatarDialogOpen}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Choose your avatar</AlertDialogTitle>
            </AlertDialogHeader>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Male</p>
                <div className="grid grid-cols-5 gap-2">
                  {MALE_AVATAR_IDS.map((avatarId) => {
                    const selected = pendingAvatarId === avatarId;
                    return (
                      <button
                        key={avatarId}
                        type="button"
                        onClick={() => setPendingAvatarId(avatarId)}
                        className={`rounded-md border p-2 transition-colors ${
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border/70 bg-card/30 hover:bg-card/50"
                        }`}
                      >
                        <UserAvatar avatarId={avatarId} username={username} className="mx-auto" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Female</p>
                <div className="grid grid-cols-5 gap-2">
                  {FEMALE_AVATAR_IDS.map((avatarId) => {
                    const selected = pendingAvatarId === avatarId;
                    return (
                      <button
                        key={avatarId}
                        type="button"
                        onClick={() => setPendingAvatarId(avatarId)}
                        className={`rounded-md border p-2 transition-colors ${
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border/70 bg-card/30 hover:bg-card/50"
                        }`}
                      >
                        <UserAvatar avatarId={avatarId} username={username} className="mx-auto" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSavingAvatar}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSaveAvatar} disabled={isSavingAvatar}>
                {isSavingAvatar ? "Saving..." : "Save Avatar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
    </TooltipProvider>
  );
};

export default Profile;
