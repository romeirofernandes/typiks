import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq } from 'drizzle-orm';
import { games, rankedGameLogs, userModeStats, users } from '../../db/schema.js';
import { requireFirebaseAuth } from '../../middleware/firebaseAuth.js';
import { calculateNewRatings } from '../../utils/rating.js';
import {
	ensureUserModeRows,
	getHighestModeRating,
	modeStatsRowToDto,
} from '../../services/user-stats.js';
import {
	normalizeModeSeconds,
	toDateValue,
} from '../../services/validation.js';
import { generateEntityId } from '../../services/ids.js';
import { DEFAULT_RATING, GAME_STATUS_FINISHED, RANKED_MODE_SECONDS } from '../../config.js';
import { logger } from '../../services/logger.js';

const statsRouter = new Hono();
const requireAuth = requireFirebaseAuth();

// Public: Get leaderboard (top 10 players by rating)
statsRouter.get('/leaderboard/top', async (c) => {
	try {
		const db = drizzle(c.env.DB);

		const topPlayers = await db
			.select({
				username: users.username,
				avatarId: users.avatarId,
				rating: users.rating,
				gamesPlayed: users.gamesPlayed,
				gamesWon: users.gamesWon,
				gamesLost: users.gamesLost,
			})
			.from(users)
			.orderBy(desc(users.rating))
			.limit(10);

		const leaderboard = topPlayers.map((player, index) => ({
			rank: index + 1,
			...player,
			winRate:
				player.gamesPlayed > 0
					? ((player.gamesWon / player.gamesPlayed) * 100).toFixed(1)
					: 0,
		}));

		return c.json({ leaderboard });
	} catch (error) {
		logger.error('Failed to fetch leaderboard', { error: error?.message });
		return c.json({ error: 'Failed to fetch leaderboard' }, 500);
	}
});

statsRouter.get('/:id/stats', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const user = await db
			.select({
				username: users.username,
				avatarId: users.avatarId,
				rating: users.rating,
			})
			.from(users)
			.where(eq(users.id, uid))
			.limit(1);

		if (user.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		await ensureUserModeRows(db, uid);

		const modeRows = await db
			.select()
			.from(userModeStats)
			.where(eq(userModeStats.userId, uid))
			.orderBy(userModeStats.modeSeconds);

		const stats = user[0];
		const aggregate = modeRows.reduce(
			(acc, row) => {
				acc.gamesPlayed += Number(row.gamesPlayed || 0);
				acc.gamesWon += Number(row.gamesWon || 0);
				acc.gamesLost += Number(row.gamesLost || 0);
				return acc;
			},
			{ gamesPlayed: 0, gamesWon: 0, gamesLost: 0 }
		);
		const winRate =
			aggregate.gamesPlayed > 0
				? ((aggregate.gamesWon / aggregate.gamesPlayed) * 100).toFixed(1)
				: 0;
		const modeStats = RANKED_MODE_SECONDS.map((modeSeconds) => {
			const row = modeRows.find((entry) => entry.modeSeconds === modeSeconds);
			if (!row) {
				return {
					modeSeconds,
					gamesPlayed: 0,
					gamesWon: 0,
					gamesLost: 0,
					gamesDrawn: 0,
					totalScore: 0,
					averageScore: 0,
					rating: DEFAULT_RATING,
				};
			}

			return modeStatsRowToDto(row);
		});

		return c.json({
			username: stats.username,
			avatarId: stats.avatarId,
			gamesPlayed: aggregate.gamesPlayed,
			gamesWon: aggregate.gamesWon,
			gamesLost: aggregate.gamesLost,
			rating: stats.rating,
			winRate: parseFloat(winRate),
			modeStats,
		});
	} catch (error) {
		logger.error('Failed to fetch user stats', { error: error?.message });
		return c.json({ error: 'Failed to fetch user stats' }, 500);
	}
});

statsRouter.get('/:id/activity', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const days = Math.min(365, Math.max(30, Number.parseInt(c.req.query('days') || '90', 10) || 90));
		const startDate = new Date();
		startDate.setHours(0, 0, 0, 0);
		startDate.setDate(startDate.getDate() - days + 1);

		const logs = await db
			.select({
				createdAt: rankedGameLogs.createdAt,
			})
			.from(rankedGameLogs)
			.where(eq(rankedGameLogs.userId, uid))
			.orderBy(rankedGameLogs.createdAt);

		const countsByDay = {};
		for (const row of logs) {
			const parsed = toDateValue(row.createdAt);
			if (!parsed || Number.isNaN(parsed.getTime()) || parsed < startDate) {
				continue;
			}

			parsed.setHours(0, 0, 0, 0);
			const dateKey = parsed.toISOString().slice(0, 10);
			countsByDay[dateKey] = (countsByDay[dateKey] || 0) + 1;
		}

		const activity = [];
		for (let index = 0; index < days; index++) {
			const date = new Date(startDate);
			date.setDate(startDate.getDate() + index);
			const dateKey = date.toISOString().slice(0, 10);
			activity.push({
				date: dateKey,
				count: countsByDay[dateKey] || 0,
			});
		}

		const maxCount = activity.reduce((max, day) => Math.max(max, day.count), 0);

		return c.json({
			days,
			maxCount,
			activity,
		});
	} catch (error) {
		logger.error('Failed to fetch user activity', { error: error?.message });
		return c.json({ error: 'Failed to fetch user activity' }, 500);
	}
});

statsRouter.get('/:id/rating-trend', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const modeSeconds = normalizeModeSeconds(c.req.query('modeSeconds') || 60);
		const limit = Math.min(
			300,
			Math.max(10, Number.parseInt(c.req.query('limit') || '120', 10) || 120)
		);

		const rows = await db
			.select({
				gameId: rankedGameLogs.gameId,
				rating: rankedGameLogs.ratingAfter,
				score: rankedGameLogs.score,
				createdAt: rankedGameLogs.createdAt,
			})
			.from(rankedGameLogs)
			.where(
				and(eq(rankedGameLogs.userId, uid), eq(rankedGameLogs.modeSeconds, modeSeconds))
			)
			.orderBy(desc(rankedGameLogs.createdAt))
			.limit(limit);

		const points = rows
			.slice()
			.reverse()
			.map((row, index) => ({
				index: index + 1,
				gameId: row.gameId,
				rating: row.rating,
				score: row.score,
				date: new Date(row.createdAt).toISOString().slice(0, 10),
			}));

		return c.json({
			modeSeconds,
			points,
		});
	} catch (error) {
		logger.error('Failed to fetch rating trend', { error: error?.message });
		return c.json({ error: 'Failed to fetch rating trend' }, 500);
	}
});

// Update game result with rating changes
statsRouter.patch('/:id/game-result', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}
		const {
			won,
			isDraw,
			opponentId,
			score,
			opponentScore,
			modeSeconds: rawModeSeconds,
			gameId,
		} = await c.req.json();

		if (typeof gameId !== 'string' || gameId.trim().length === 0) {
			return c.json({ error: 'gameId is required' }, 400);
		}
		if (typeof opponentId !== 'string' || opponentId.length === 0) {
			return c.json({ error: 'opponentId is required' }, 400);
		}
		if (opponentId === uid) {
			return c.json({ error: 'opponentId must be different from player id' }, 400);
		}

		const modeSeconds = normalizeModeSeconds(rawModeSeconds);
		const gameWriteTime = new Date();

		// Insert the game row idempotently. Both players submit their result
		// for the same gameId concurrently, so a check-then-insert races and
		// one request would fail with a UNIQUE constraint. onConflictDoNothing
		// turns that race into a no-op; the mode/status checks below then run
		// against the row that won.
		await db
			.insert(games)
			.values({
				id: gameId,
				modeSeconds,
				difficulty: 'medium',
				seed: 0,
				status: GAME_STATUS_FINISHED,
				createdAt: gameWriteTime,
				finishedAt: gameWriteTime,
			})
			.onConflictDoNothing();

		const storedGame = await db
			.select({ id: games.id, modeSeconds: games.modeSeconds, status: games.status })
			.from(games)
			.where(eq(games.id, gameId))
			.limit(1);

		if (storedGame.length === 0) {
			return c.json({ error: 'Failed to store game' }, 500);
		}

		if (storedGame[0].modeSeconds !== modeSeconds) {
			return c.json({ error: 'modeSeconds does not match the stored game mode' }, 409);
		}

		if (storedGame[0].status !== GAME_STATUS_FINISHED) {
			await db
				.update(games)
				.set({
					status: GAME_STATUS_FINISHED,
					finishedAt: gameWriteTime,
				})
				.where(eq(games.id, gameId));
		}

		const isGameDraw = Boolean(isDraw);
		const playerWon = isGameDraw ? false : Boolean(won);
		const playerScore = Math.max(0, Number.parseInt(String(score), 10) || 0);
		const rivalScore = Math.max(0, Number.parseInt(String(opponentScore), 10) || 0);

		const existingLog = await db
			.select({
				ratingAfter: rankedGameLogs.ratingAfter,
				ratingBefore: rankedGameLogs.ratingBefore,
			})
			.from(rankedGameLogs)
			.where(and(eq(rankedGameLogs.gameId, gameId), eq(rankedGameLogs.userId, uid)))
			.limit(1);

		if (existingLog.length > 0) {
			const [playerStatsRow] = await db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1);

			if (playerStatsRow) {
				return c.json({
					player: {
						id: uid,
						rating: playerStatsRow.rating,
					},
					modeStats: modeStatsRowToDto(playerStatsRow),
					ratingChange: existingLog[0].ratingAfter - existingLog[0].ratingBefore,
					idempotent: true,
				});
			}
		}

		// Get both players
		const [player, opponent] = await Promise.all([
			db.select().from(users).where(eq(users.id, uid)).limit(1),
			db.select().from(users).where(eq(users.id, opponentId)).limit(1),
		]);

		if (player.length === 0 || opponent.length === 0) {
			return c.json({ error: 'Player not found' }, 404);
		}

		const playerData = player[0];
		const opponentData = opponent[0];

		await Promise.all([ensureUserModeRows(db, uid), ensureUserModeRows(db, opponentId)]);

		const [playerModeStatsRows, opponentModeStatsRows] = await Promise.all([
			db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1),
			db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, opponentId), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1),
		]);

		const playerModeStats = playerModeStatsRows[0];
		const opponentModeStats = opponentModeStatsRows[0];

		if (!playerModeStats || !opponentModeStats) {
			return c.json({ error: 'Failed to initialize mode stats' }, 500);
		}

		// Calculate new ratings
		const playerResultScore = isGameDraw ? 0.5 : playerWon ? 1 : 0;
		const opponentResultScore = isGameDraw ? 0.5 : playerWon ? 0 : 1;

		const newPlayerRating = calculateNewRatings(
			playerModeStats.rating,
			opponentModeStats.rating,
			playerResultScore,
			{ gamesPlayed: playerModeStats.gamesPlayed }
		);
		const newOpponentRating = calculateNewRatings(
			opponentModeStats.rating,
			playerModeStats.rating,
			opponentResultScore,
			{ gamesPlayed: opponentModeStats.gamesPlayed }
		);

		const now = new Date();

		// Idempotency gate: both players submit their result for the same
		// gameId concurrently. The earlier SELECT-only check (above) raced,
		// letting both requests pass and double-increment both players' stats.
		// Instead, insert both log rows atomically with onConflictDoNothing and
		// use the number of rows actually inserted to decide the winner. Only
		// the request that inserts the rows updates the stats; the loser
		// returns idempotent.
		const logInsertResult = await db
			.insert(rankedGameLogs)
			.values([
				{
					id: generateEntityId('match'),
					gameId,
					userId: uid,
					opponentId,
					modeSeconds,
					score: playerScore,
					opponentScore: rivalScore,
					won: playerWon ? 1 : 0,
					isDraw: isGameDraw ? 1 : 0,
					ratingBefore: playerModeStats.rating,
					ratingAfter: newPlayerRating,
					createdAt: now,
				},
				{
					id: generateEntityId('match'),
					gameId,
					userId: opponentId,
					opponentId: uid,
					modeSeconds,
					score: rivalScore,
					opponentScore: playerScore,
					won: !isGameDraw && !playerWon ? 1 : 0,
					isDraw: isGameDraw ? 1 : 0,
					ratingBefore: opponentModeStats.rating,
					ratingAfter: newOpponentRating,
					createdAt: now,
				},
			])
			.onConflictDoNothing()
			.returning({ id: rankedGameLogs.id });

		const insertedLogs = Array.isArray(logInsertResult) ? logInsertResult : (logInsertResult?.results ?? []);
		const insertedLogCount = insertedLogs.length;

		if (insertedLogCount < 2) {
			// Another request already recorded this game. Read the current
			// stats so the idempotent response reflects the stored result.
			const [currentStatsRow] = await db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1);
			const [existingResultLog] = await db
				.select({
					ratingBefore: rankedGameLogs.ratingBefore,
					ratingAfter: rankedGameLogs.ratingAfter,
				})
				.from(rankedGameLogs)
				.where(and(eq(rankedGameLogs.gameId, gameId), eq(rankedGameLogs.userId, uid)))
				.limit(1);

			return c.json({
				player: {
					id: uid,
					rating: currentStatsRow?.rating ?? null,
				},
				modeStats: currentStatsRow ? modeStatsRowToDto(currentStatsRow) : null,
				ratingChange: existingResultLog
					? existingResultLog.ratingAfter - existingResultLog.ratingBefore
					: 0,
				idempotent: true,
			});
		}

		const playerModeGamesPlayed = playerModeStats.gamesPlayed + 1;
		const opponentModeGamesPlayed = opponentModeStats.gamesPlayed + 1;

		const updatedPlayerModeStatsPromise = db
			.update(userModeStats)
			.set({
				gamesPlayed: playerModeGamesPlayed,
				gamesWon: playerWon ? playerModeStats.gamesWon + 1 : playerModeStats.gamesWon,
				gamesLost: !isGameDraw && !playerWon ? playerModeStats.gamesLost + 1 : playerModeStats.gamesLost,
				gamesDrawn: isGameDraw ? playerModeStats.gamesDrawn + 1 : playerModeStats.gamesDrawn,
				totalScore: playerModeStats.totalScore + playerScore,
				rating: newPlayerRating,
				updatedAt: now,
			})
			.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
			.returning();

		const updatedOpponentModeStatsPromise = db
			.update(userModeStats)
			.set({
				gamesPlayed: opponentModeGamesPlayed,
				gamesWon: !isGameDraw && !playerWon ? opponentModeStats.gamesWon + 1 : opponentModeStats.gamesWon,
				gamesLost: playerWon ? opponentModeStats.gamesLost + 1 : opponentModeStats.gamesLost,
				gamesDrawn: isGameDraw ? opponentModeStats.gamesDrawn + 1 : opponentModeStats.gamesDrawn,
				totalScore: opponentModeStats.totalScore + rivalScore,
				rating: newOpponentRating,
				updatedAt: now,
			})
			.where(and(eq(userModeStats.userId, opponentId), eq(userModeStats.modeSeconds, modeSeconds)))
			.returning();

		// Update both players
		const [updatedPlayerModeStats, updatedOpponentModeStats] =
			await Promise.all([
			updatedPlayerModeStatsPromise,
			updatedOpponentModeStatsPromise,
		]);

		const [nextPlayerRating, nextOpponentRating] = await Promise.all([
			getHighestModeRating(db, uid),
			getHighestModeRating(db, opponentId),
		]);

		const [updatedPlayer, updatedOpponent] = await Promise.all([
			db
				.update(users)
				.set({
					gamesPlayed: playerData.gamesPlayed + 1,
					gamesWon: playerWon ? playerData.gamesWon + 1 : playerData.gamesWon,
					gamesLost: !isGameDraw && !playerWon ? playerData.gamesLost + 1 : playerData.gamesLost,
					rating: nextPlayerRating,
				})
				.where(eq(users.id, uid))
				.returning(),
			db
				.update(users)
				.set({
					gamesPlayed: opponentData.gamesPlayed + 1,
					gamesWon: !isGameDraw && !playerWon ? opponentData.gamesWon + 1 : opponentData.gamesWon,
					gamesLost: playerWon ? opponentData.gamesLost + 1 : opponentData.gamesLost,
					rating: nextOpponentRating,
				})
				.where(eq(users.id, opponentId))
				.returning(),
		]);

		return c.json({
			player: updatedPlayer[0],
			opponent: updatedOpponent[0],
			modeStats: modeStatsRowToDto(updatedPlayerModeStats[0]),
			opponentModeStats: modeStatsRowToDto(updatedOpponentModeStats[0]),
			ratingChange: newPlayerRating - playerModeStats.rating,
			opponentRatingChange: newOpponentRating - opponentModeStats.rating,
		});
	} catch (error) {
		logger.error('Failed to update game result', { error: error?.message });
		return c.json({ error: 'Failed to update game result' }, 500);
	}
});

export default statsRouter;
