export const AVATAR_IDS = [
  "avatar1",
  "avatar2",
  "avatar3",
  "avatar4",
  "avatar5",
  "avatar6",
  "avatar7",
  "avatar8",
  "avatar9",
  "avatar10",
];

export const MALE_AVATAR_IDS = ["avatar1", "avatar2", "avatar3", "avatar4", "avatar5"];
export const FEMALE_AVATAR_IDS = ["avatar6", "avatar7", "avatar8", "avatar9", "avatar10"];

export const DEFAULT_AVATAR_ID = "avatar1";

export function normalizeAvatarId(value) {
  if (typeof value !== "string") return DEFAULT_AVATAR_ID;
  const normalized = value.trim().toLowerCase();
  return AVATAR_IDS.includes(normalized) ? normalized : DEFAULT_AVATAR_ID;
}

export function getAvatarPath(avatarId) {
  return `/${normalizeAvatarId(avatarId)}.svg`;
}

export function getRandomDefaultAvatarId() {
  const index = Math.floor(Math.random() * AVATAR_IDS.length);
  return AVATAR_IDS[index] || DEFAULT_AVATAR_ID;
}

export const RATING_TIERS = [
  {
    min: 1700,
    label: "Mythic",
    description: "Top 1% typing aura. Fast, precise, and absurdly consistent.",
    color: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  },
  {
    min: 1500,
    label: "Knight",
    description: "Serious pace and clean control. You rarely fumble pressure rounds.",
    color: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  },
  {
    min: 1300,
    label: "Vanguard",
    description: "Confident, reliable, and usually ahead of lobby tempo.",
    color: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  },
  {
    min: 1100,
    label: "Contender",
    description: "Good fundamentals with enough speed to win close games.",
    color: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  },
  {
    min: 900,
    label: "Cadet",
    description: "Progress phase. Building rhythm, control, and match confidence.",
    color: "bg-primary/10 text-primary border-primary/25",
  },
  {
    min: 0,
    label: "Rookie",
    description: "Starting rank. Lock in accuracy first, speed follows.",
    color: "bg-muted text-muted-foreground border-border",
  },
];

export function getTierByRating(rating) {
  const safeRating = Number.isFinite(Number(rating)) ? Number(rating) : 0;
  return RATING_TIERS.find((tier) => safeRating >= tier.min) || RATING_TIERS.at(-1);
}
