export const WORDS_PER_SECOND_CEILING = 5;

export function timedSupplySize(seconds) {
  return Math.ceil(seconds * WORDS_PER_SECOND_CEILING) + 20;
}

export function wpmFromChars(correctChars, elapsedMs) {
  const minutes = Math.max(elapsedMs, 1) / 60000;
  return correctChars / 5 / minutes;
}

export function accuracyFromChars(correctChars, wrongChars) {
  const total = correctChars + wrongChars;
  if (total === 0) return 100;
  return (correctChars / total) * 100;
}

export function formatSeconds(totalSeconds) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
