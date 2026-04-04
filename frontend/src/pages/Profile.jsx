import { useAuth } from "@/context/AuthContext";
import { TypeGraph } from "@/components/charts/TypeGraph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const PROFILE_GRAPH_DAYS = 364;
const UNSET_OPTION_VALUE = "__unset__";
const SEARCH_DEBOUNCE_MS = 250;

const Profile = () => {
  const { currentUser } = useAuth();
  const [activityData, setActivityData] = useState([]);
  const [maxCount, setMaxCount] = useState(0);
  const [countryOptions, setCountryOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [countryQuery, setCountryQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [countryIsTyping, setCountryIsTyping] = useState(false);
  const [cityIsTyping, setCityIsTyping] = useState(false);
  const [isLocationEditing, setIsLocationEditing] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationApiReady, setLocationApiReady] = useState(false);
  const [playerPreferences, setPlayerPreferences] = useState(() =>
    loadPlayerPreferences()
  );

  const username =
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";
  const selectedCountry = playerPreferences.country;
  const submitKeyIds = Array.isArray(playerPreferences.submitKeyIds)
    ? playerPreferences.submitKeyIds
    : [playerPreferences.submitKeyId].filter(Boolean);
  const submitKeyOne = submitKeyIds[0] || "space";
  const submitKeyTwo = submitKeyIds[1] || UNSET_OPTION_VALUE;

  useEffect(() => {
    const fetchProfileData = async () => {
      if (!currentUser) return;

      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const [statsResponse, activityResponse, locationResponse] = await Promise.all([
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
        ]);

        if (statsResponse.ok) {
          await statsResponse.json();
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
              city: payload.city || "",
            })
          );
          setCountryQuery(payload.country || "");
          setCityQuery(payload.city || "");
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
    if (!currentUser || !selectedCountry || !locationApiReady || !cityIsTyping) {
      setCityOptions([]);
      return;
    }

    const query = cityQuery.trim();
    if (query.length === 0) {
      setCityOptions([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const response = await fetch(
          `${fullUrl}/api/users/locations/cities?country=${encodeURIComponent(
            selectedCountry
          )}&query=${encodeURIComponent(query)}&limit=12`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        if (!response.ok) {
          setCityOptions([]);
          return;
        }

        const payload = await response.json();
        setCityOptions(Array.isArray(payload.cities) ? payload.cities : []);
      } catch (error) {
        console.error("Failed to fetch cities:", error);
        setCityOptions([]);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [cityIsTyping, cityQuery, currentUser, locationApiReady, selectedCountry]);

  const persistLocation = async (country, city) => {
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
          city: city || null,
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
  };

  const updateSubmitKey = (index, value) => {
    const normalizedValue = value === UNSET_OPTION_VALUE ? null : value;

    setPlayerPreferences((prev) => {
      const currentIds = Array.isArray(prev.submitKeyIds)
        ? prev.submitKeyIds
        : [prev.submitKeyId].filter(Boolean);

      const draft = [currentIds[0] || "space", currentIds[1] || null];

      if (index === 0) {
        draft[0] = normalizedValue || "space";
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
        city: "",
      });
      return next;
    });

    setCountryQuery(normalizedCountry);
    setCityQuery("");
    setCountryIsTyping(false);
    setCityIsTyping(false);
  };

  const handleCityChange = (value) => {
    setPlayerPreferences((prev) => {
      const normalizedValue = value === UNSET_OPTION_VALUE ? "" : value;
      const next = savePlayerPreferences({
        ...prev,
        city: normalizedValue,
      });
      return next;
    });

    setCityQuery(value === UNSET_OPTION_VALUE ? "" : value);
    setCityIsTyping(false);
  };

  const handleSaveLocation = async () => {
    setIsSavingLocation(true);
    await persistLocation(playerPreferences.country, playerPreferences.city);
    setIsSavingLocation(false);
    setIsLocationEditing(false);
    setCountryIsTyping(false);
    setCityIsTyping(false);
  };

  return (
    <div className="flex h-full items-start">
      <div className="w-full space-y-8">
        <header className="space-y-2 border-b border-border/60 pb-5">
          <h1 className="flex items-center gap-2 font-sans text-2xl font-semibold tracking-tight">
            <ViewIcon size={20} />
            Profile
          </h1>
          <p className="text-sm text-muted-foreground">
            Account details from your sign in provider.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/40 p-4">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Username
            </p>
            <p className="mt-2 font-sans text-lg font-semibold">{username}</p>
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

        <section className="grid items-stretch gap-6 xl:grid-cols-[minmax(290px,360px)_minmax(0,1fr)]">
          <div className="h-full space-y-5 rounded-lg border border-border/70 bg-background/40 p-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Typing Preferences
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

              <div className="space-y-2">
                <Label htmlFor="city-select">City</Label>
                <Input
                  id="city-select"
                  value={cityQuery}
                  placeholder={selectedCountry ? "Type city" : "Select country first"}
                  onChange={(event) => {
                    if (!isLocationEditing) return;
                    setCityQuery(event.target.value);
                    setCityIsTyping(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setCityIsTyping(false), 120);
                  }}
                  disabled={!selectedCountry || !isLocationEditing}
                />
                {isLocationEditing && cityIsTyping && cityQuery.trim().length > 0 && cityOptions.length > 0 && (
                  <div className="max-h-36 overflow-y-auto rounded-md border border-border/70 bg-background/90 p-1">
                    {cityOptions.map((city) => (
                      <button
                        key={city}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleCityChange(city)}
                        className="hover:bg-accent hover:text-accent-foreground w-full rounded-sm px-2 py-1 text-left text-sm"
                      >
                        {city}
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
      </div>
    </div>
  );
};

export default Profile;
