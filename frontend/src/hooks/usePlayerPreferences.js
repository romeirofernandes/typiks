import { useSyncExternalStore } from "react";
import {
  loadPlayerPreferences,
  savePlayerPreferences,
  PLAYER_PREFERENCES_STORAGE_KEY,
} from "@/lib/player-preferences";

const listeners = new Set();

let cachedSnapshot = null;

function getSnapshot() {
  if (cachedSnapshot === null) {
    cachedSnapshot = loadPlayerPreferences();
  }
  return cachedSnapshot;
}

function emitChange() {
  cachedSnapshot = null;
  for (const listener of listeners) {
    listener();
  }
}

function handleStorageChange(event) {
  if (event.key !== PLAYER_PREFERENCES_STORAGE_KEY) return;
  emitChange();
}

function handleFocusChange() {
  emitChange();
}

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener("storage", handleStorageChange);
  window.addEventListener("focus", handleFocusChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener("focus", handleFocusChange);
  };
}

export function setPlayerPreferences(updater) {
  const next = savePlayerPreferences(
    typeof updater === "function" ? updater(getSnapshot()) : updater
  );
  emitChange();
  return next;
}

export function usePlayerPreferences() {
  const playerPreferences = useSyncExternalStore(subscribe, getSnapshot);

  return [playerPreferences, setPlayerPreferences];
}