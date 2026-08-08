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

export async function getHighestModeRating(db, userId) {
	const rows = await db
		.select({ rating: userModeStats.rating })
		.from(userModeStats)
		.where(eq(userModeStats.userId, userId));

	if (!rows.length) return DEFAULT_RATING;
	return rows.reduce((max, row) => Math.max(max, Number(row.rating || DEFAULT_RATING)), DEFAULT_RATING);
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
