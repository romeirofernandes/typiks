const PLAYER_PREFERENCES_STORAGE_KEY = "typiks:player-preferences";

const NEXT_WORD_CONDITIONS = {
  manual: "manual",
  auto: "auto",
};

const SUBMIT_KEY_OPTIONS = [
  { id: "space", label: "Space", key: " " },
  { id: "enter", label: "Enter", key: "Enter" },
  { id: "tab", label: "Tab", key: "Tab" },
  { id: "comma", label: "Comma (,)", key: "," },
  { id: "period", label: "Period (.)", key: "." },
  { id: "slash", label: "Slash (/)", key: "/" },
  { id: "semicolon", label: "Semicolon (;)", key: ";" },
];

const DEFAULT_PLAYER_PREFERENCES = {
  city: "",
  country: "",
  nextWordCondition: NEXT_WORD_CONDITIONS.manual,
  submitKeyIds: ["space", "enter"],
};

function normalizeTextValue(value, maxLength = 64) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function getSubmitKeyOptionById(id) {
  return SUBMIT_KEY_OPTIONS.find((option) => option.id === id) || SUBMIT_KEY_OPTIONS[0];
}

function normalizeSubmitKeyIds(rawSubmitKeyIds, rawSingleSubmitKeyId) {
  const source = Array.isArray(rawSubmitKeyIds)
    ? rawSubmitKeyIds
    : rawSingleSubmitKeyId
    ? [rawSingleSubmitKeyId]
    : DEFAULT_PLAYER_PREFERENCES.submitKeyIds;

  const normalized = [];

  for (const candidate of source) {
    const option = SUBMIT_KEY_OPTIONS.find((entry) => entry.id === candidate);
    if (!option) continue;
    if (normalized.includes(option.id)) continue;
    normalized.push(option.id);
    if (normalized.length === 2) break;
  }

  if (normalized.length === 0) {
    normalized.push(DEFAULT_PLAYER_PREFERENCES.submitKeyIds[0]);
  }

  return normalized;
}

export function normalizePlayerPreferences(rawValue) {
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
  const nextWordCondition =
    raw.nextWordCondition === NEXT_WORD_CONDITIONS.auto
      ? NEXT_WORD_CONDITIONS.auto
      : NEXT_WORD_CONDITIONS.manual;

  const submitKeyIds = normalizeSubmitKeyIds(raw.submitKeyIds, raw.submitKeyId);

  return {
    city: normalizeTextValue(raw.city),
    country: normalizeTextValue(raw.country),
    nextWordCondition,
    submitKeyIds,
    // Keep legacy field for any untouched old consumers.
    submitKeyId: submitKeyIds[0],
  };
}

export function loadPlayerPreferences() {
  if (typeof window === "undefined") {
    return { ...DEFAULT_PLAYER_PREFERENCES };
  }

  try {
    const stored = window.localStorage.getItem(PLAYER_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_PLAYER_PREFERENCES };
    }

    const parsed = JSON.parse(stored);
    return normalizePlayerPreferences(parsed);
  } catch {
    return { ...DEFAULT_PLAYER_PREFERENCES };
  }
}

export function savePlayerPreferences(preferences) {
  const normalized = normalizePlayerPreferences(preferences);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      PLAYER_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  }

  return normalized;
}

export {
  DEFAULT_PLAYER_PREFERENCES,
  NEXT_WORD_CONDITIONS,
  PLAYER_PREFERENCES_STORAGE_KEY,
  SUBMIT_KEY_OPTIONS,
};