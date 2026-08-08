import { useEffect, useState } from "react";
import {
  loadPlayerPreferences,
  PLAYER_PREFERENCES_STORAGE_KEY,
} from "@/lib/player-preferences";

export function usePlayerPreferences() {
  const [playerPreferences, setPlayerPreferences] = useState(() =>
    loadPlayerPreferences()
  );

  useEffect(() => {
    const syncPreferences = () => {
      setPlayerPreferences(loadPlayerPreferences());
    };

    syncPreferences();
    window.addEventListener("storage", syncPreferences);

    return () => {
      window.removeEventListener("storage", syncPreferences);
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      const stored = window.localStorage.getItem(PLAYER_PREFERENCES_STORAGE_KEY);
      if (stored) {
        setPlayerPreferences(loadPlayerPreferences());
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return [playerPreferences, setPlayerPreferences];
}
