import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq } from 'drizzle-orm';
import { rankedGameLogs, userModeStats, users } from '../../db/schema.js';
import { requireFirebaseAuth } from '../../middleware/firebaseAuth.js';
import {
	ensureUserModeRows,
	modeStatsRowToDto,
} from '../../services/user-stats.js';
import {
	normalizeModeSeconds,
	toDateValue,
} from '../../services/validation.js';
import { DEFAULT_RATING, RANKED_MODE_SECONDS } from '../../config.js';
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

export default statsRouter;
