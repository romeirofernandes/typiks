import { eq } from 'drizzle-orm';
import { userModeStats } from '../db/schema.js';
import { DEFAULT_RATING, RANKED_MODE_SECONDS } from '../config.js';

export function modeStatsRowToDto(row) {
	const gamesPlayed = Number(row.gamesPlayed || 0);
	const totalScore = Number(row.totalScore || 0);
	const averageScore = gamesPlayed > 0 ? totalScore / gamesPlayed : 0;

	return {
		modeSeconds: row.modeSeconds,
		gamesPlayed,
		gamesWon: row.gamesWon,
		gamesLost: row.gamesLost,
		gamesDrawn: row.gamesDrawn,
		totalScore,
		averageScore,
		rating: row.rating,
	};
}

// Single owner of the derived `users.rating` cache: it is always the highest
// rating across a user's ranked mode rows. Mode ratings only ever rise through
// this function (a loss drops a mode row but never the cache).
export function deriveHighestRating(modeStatsRows) {
	if (!modeStatsRows.length) return DEFAULT_RATING;
	return modeStatsRows.reduce(
		(highest, row) => Math.max(highest, Number(row.rating ?? DEFAULT_RATING)),
		DEFAULT_RATING
	);
}

export async function getHighestModeRating(db, userId) {
	const rows = await db
		.select({ rating: userModeStats.rating })
		.from(userModeStats)
		.where(eq(userModeStats.userId, userId));

	return deriveHighestRating(rows);
}

export async function ensureUserModeRows(db, userId) {
	const now = new Date();
	const existingRows = await db
		.select({ modeSeconds: userModeStats.modeSeconds })
		.from(userModeStats)
		.where(eq(userModeStats.userId, userId));

	const existingModeSet = new Set(existingRows.map((row) => row.modeSeconds));
	const missingModes = RANKED_MODE_SECONDS.filter((mode) => !existingModeSet.has(mode));

	if (missingModes.length === 0) {
		return;
	}

	await db
		.insert(userModeStats)
		.values(
			missingModes.map((modeSeconds) => ({
				userId,
				modeSeconds,
				gamesPlayed: 0,
				gamesWon: 0,
				gamesLost: 0,
				gamesDrawn: 0,
				totalScore: 0,
				rating: DEFAULT_RATING,
				updatedAt: now,
			}))
		)
		.onConflictDoNothing();
}
