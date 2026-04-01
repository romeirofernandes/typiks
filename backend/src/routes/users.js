import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	friendships,
	friendRequests,
	rankedGameLogs,
	userModeStats,
	users,
} from '../db/schema.js';
import { calculateNewRatings } from '../utils/rating.js';
import { requireFirebaseAuth } from '../middleware/firebaseAuth.js';

const userRouter = new Hono();

const requireAuth = requireFirebaseAuth();

const FRIEND_REQUEST_PENDING = 'pending';
const FRIEND_REQUEST_ACCEPTED = 'accepted';
const FRIEND_REQUEST_DECLINED = 'declined';
const RANKED_MODE_SECONDS = [15, 30, 60, 120];
const DEFAULT_RATING = 800;

function generateEntityId(prefix) {
	if (typeof crypto?.randomUUID === 'function') {
		return `${prefix}_${crypto.randomUUID()}`;
	}

	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUsername(value) {
	if (typeof value !== 'string') return null;
	const username = value.trim().toLowerCase();
	if (username.length < 3 || username.length > 24) return null;
	if (!/^[a-z0-9._-]+$/.test(username)) return null;
	return username;
}

function normalizeModeSeconds(rawValue) {
	const parsed = Number.parseInt(String(rawValue), 10);
	if (!Number.isFinite(parsed) || !RANKED_MODE_SECONDS.includes(parsed)) {
		return 60;
	}

	return parsed;
}

function modeStatsRowToDto(row) {
	return {
		modeSeconds: row.modeSeconds,
		gamesPlayed: row.gamesPlayed,
		gamesWon: row.gamesWon,
		gamesLost: row.gamesLost,
		gamesDrawn: row.gamesDrawn,
		totalScore: row.totalScore,
		averageScore: Number(row.averageScore || 0),
		rating: row.rating,
	};
}

async function ensureUserModeRows(db, userId) {
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
				averageScore: 0,
				rating: DEFAULT_RATING,
				updatedAt: now,
			}))
		)
		.onConflictDoNothing();
}

async function createFriendshipPair(db, userId, friendId) {
	if (!userId || !friendId || userId === friendId) return;

	const now = new Date();

	await Promise.all([
		db
			.insert(friendships)
			.values({ userId, friendId, createdAt: now })
			.onConflictDoNothing(),
		db
			.insert(friendships)
			.values({ userId: friendId, friendId: userId, createdAt: now })
			.onConflictDoNothing(),
	]);
}

// Public: Get leaderboard (top 10 players by rating)
userRouter.get('/leaderboard/top', async (c) => {
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
		return c.json({ error: 'Failed to fetch leaderboard' }, 500);
	}
});

// Authenticated: create (or get) the current user's profile
userRouter.post('/', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const body = await c.req.json().catch(() => ({}));
		const requestedUsername = body?.username;
		const auth = c.get('auth');
		const uid = auth?.uid;
		const email = auth?.email;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}
		if (!email) {
			return c.json(
				{ error: 'Account has no email; email is required to create a profile' },
				400
			);
		}
		const existingUser = await db.select().from(users).where(eq(users.id, uid)).limit(1);

		if (existingUser.length > 0) {
			return c.json({ user: existingUser[0], message: 'User already exists' });
		}

		const sanitizeBaseUsername = (value) => {
			if (typeof value !== 'string') return null;
			const trimmed = value.trim();
			if (trimmed.length < 3) return null;
			const cleaned = trimmed
				.toLowerCase()
				.replace(/\s+/g, '-')
				.replace(/[^a-z0-9._-]/g, '')
				.slice(0, 24);
			return cleaned.length >= 3 ? cleaned : null;
		};

		const emailLocalPart = email.split('@')[0] || 'player';
		const baseFromEmail = sanitizeBaseUsername(emailLocalPart) || 'player';
		const baseRequested = sanitizeBaseUsername(requestedUsername);
		const base = baseRequested || baseFromEmail;

		const isUsernameTaken = async (candidate) => {
			const rows = await db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.username, candidate))
				.limit(1);
			return rows.length > 0;
		};

		let chosenUsername = base;
		if (await isUsernameTaken(chosenUsername)) {
			if (baseRequested) {
				return c.json({ error: 'Username already taken' }, 409);
			}
			let attempt = 0;
			while (attempt < 5) {
				attempt++;
				const suffix = Math.random().toString(36).slice(2, 6);
				const candidate = `${base.slice(0, Math.max(3, 24 - suffix.length - 1))}-${suffix}`;
				if (!(await isUsernameTaken(candidate))) {
					chosenUsername = candidate;
					break;
				}
			}
		}

		let newUser;
		let attempts = 0;
		while (attempts < 3) {
			attempts++;
			try {
				newUser = await db
					.insert(users)
					.values({
						id: uid,
						username: chosenUsername,
						email,
						gamesPlayed: 0,
						gamesWon: 0,
						gamesLost: 0,
						rating: 800,
						createdAt: new Date(),
					})
					.returning();
				break;
			} catch (error) {
				console.error('Failed to insert user:', error);
				const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
				if (byEmail.length > 0 && byEmail[0].id !== uid) {
					return c.json(
						{ error: 'Email is already in use by a different account' },
						409
					);
				}
				if (baseRequested) {
					return c.json({ error: 'Username already taken' }, 409);
				}
				// Likely a username race; try a new suffix.
				const suffix = Math.random().toString(36).slice(2, 6);
				chosenUsername = `${base.slice(0, Math.max(3, 24 - suffix.length - 1))}-${suffix}`;
			}
		}

		if (!newUser || !newUser[0]) {
			return c.json({ error: 'Failed to create user' }, 500);
		}

		await ensureUserModeRows(db, uid);

		return c.json({ user: newUser[0], message: 'User created successfully' });
	} catch (error) {
		return c.json({ error: 'Failed to create user', details: error.message }, 500);
	}
});

userRouter.get('/:id', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const user = await db.select().from(users).where(eq(users.id, uid)).limit(1);

		if (user.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({ user: user[0] });
	} catch (error) {
		return c.json({ error: 'Failed to fetch user' }, 500);
	}
});

// Update game result with rating changes
userRouter.patch('/:id/game-result', requireAuth, async (c) => {
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

		const playerModeGamesPlayed = playerModeStats.gamesPlayed + 1;
		const opponentModeGamesPlayed = opponentModeStats.gamesPlayed + 1;
		const now = new Date();

		const updatedPlayerModeStatsPromise = db
			.update(userModeStats)
			.set({
				gamesPlayed: playerModeGamesPlayed,
				gamesWon: playerWon ? playerModeStats.gamesWon + 1 : playerModeStats.gamesWon,
				gamesLost: !isGameDraw && !playerWon ? playerModeStats.gamesLost + 1 : playerModeStats.gamesLost,
				gamesDrawn: isGameDraw ? playerModeStats.gamesDrawn + 1 : playerModeStats.gamesDrawn,
				totalScore: playerModeStats.totalScore + playerScore,
				averageScore: (playerModeStats.totalScore + playerScore) / playerModeGamesPlayed,
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
				averageScore: (opponentModeStats.totalScore + rivalScore) / opponentModeGamesPlayed,
				rating: newOpponentRating,
				updatedAt: now,
			})
			.where(and(eq(userModeStats.userId, opponentId), eq(userModeStats.modeSeconds, modeSeconds)))
			.returning();

		// Update both players
		const [updatedPlayer, updatedOpponent, updatedPlayerModeStats, updatedOpponentModeStats] =
			await Promise.all([
			db
				.update(users)
				.set({
					gamesPlayed: playerData.gamesPlayed + 1,
					gamesWon: playerWon ? playerData.gamesWon + 1 : playerData.gamesWon,
					gamesLost: !isGameDraw && !playerWon ? playerData.gamesLost + 1 : playerData.gamesLost,
					rating: newPlayerRating,
				})
				.where(eq(users.id, uid))
				.returning(),

			db
				.update(users)
				.set({
					gamesPlayed: opponentData.gamesPlayed + 1,
					gamesWon: !isGameDraw && !playerWon ? opponentData.gamesWon + 1 : opponentData.gamesWon,
					gamesLost: playerWon ? opponentData.gamesLost + 1 : opponentData.gamesLost,
					rating: newOpponentRating,
				})
				.where(eq(users.id, opponentId))
				.returning(),
			updatedPlayerModeStatsPromise,
			updatedOpponentModeStatsPromise,
		]);

		await Promise.all([
			db.insert(rankedGameLogs).values({
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
			}),
			db.insert(rankedGameLogs).values({
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
			}),
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
		console.error('Failed to update game result:', error);
		return c.json({ error: 'Failed to update game result' }, 500);
	}
});

userRouter.get('/:id/stats', requireAuth, async (c) => {
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
				gamesPlayed: users.gamesPlayed,
				gamesWon: users.gamesWon,
				gamesLost: users.gamesLost,
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
		const winRate = stats.gamesPlayed > 0 ? ((stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1) : 0;
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
			...stats,
			winRate: parseFloat(winRate),
			modeStats,
		});
	} catch (error) {
		return c.json({ error: 'Failed to fetch user stats' }, 500);
	}
});

userRouter.get('/:id/activity', requireAuth, async (c) => {
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
				activityDate: sql`date(${rankedGameLogs.createdAt})`.as('activity_date'),
				count: sql`count(*)`.as('count'),
			})
			.from(rankedGameLogs)
			.where(and(eq(rankedGameLogs.userId, uid), sql`${rankedGameLogs.createdAt} >= ${startDate}`))
			.groupBy(sql`date(${rankedGameLogs.createdAt})`)
			.orderBy(sql`date(${rankedGameLogs.createdAt})`);

		const countsByDay = {};
		for (const row of logs) {
			countsByDay[row.activityDate] = Number(row.count || 0);
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
		console.error('Failed to fetch user activity:', error);
		return c.json({ error: 'Failed to fetch user activity' }, 500);
	}
});

userRouter.get('/me/friends', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const friendUser = alias(users, 'friend_user');

		const friends = await db
			.select({
				id: friendUser.id,
				username: friendUser.username,
				rating: friendUser.rating,
				gamesPlayed: friendUser.gamesPlayed,
				gamesWon: friendUser.gamesWon,
				gamesLost: friendUser.gamesLost,
				friendsSince: friendships.createdAt,
			})
			.from(friendships)
			.innerJoin(friendUser, eq(friendships.friendId, friendUser.id))
			.where(eq(friendships.userId, uid))
			.orderBy(desc(friendships.createdAt));

		return c.json({ friends });
	} catch (error) {
		console.error('Failed to fetch friends:', error);
		return c.json({ error: 'Failed to fetch friends' }, 500);
	}
});

userRouter.get('/me/friend-requests', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const senderUser = alias(users, 'sender_user');
		const receiverUser = alias(users, 'receiver_user');

		const [incoming, outgoing] = await Promise.all([
			db
				.select({
					id: friendRequests.id,
					senderId: friendRequests.senderId,
					senderUsername: senderUser.username,
					senderRating: senderUser.rating,
					createdAt: friendRequests.createdAt,
				})
				.from(friendRequests)
				.innerJoin(senderUser, eq(friendRequests.senderId, senderUser.id))
				.where(
					and(
						eq(friendRequests.receiverId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING)
					)
				)
				.orderBy(desc(friendRequests.createdAt)),
			db
				.select({
					id: friendRequests.id,
					receiverId: friendRequests.receiverId,
					receiverUsername: receiverUser.username,
					receiverRating: receiverUser.rating,
					createdAt: friendRequests.createdAt,
				})
				.from(friendRequests)
				.innerJoin(receiverUser, eq(friendRequests.receiverId, receiverUser.id))
				.where(
					and(
						eq(friendRequests.senderId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING)
					)
				)
				.orderBy(desc(friendRequests.createdAt)),
		]);

		return c.json({ incoming, outgoing });
	} catch (error) {
		console.error('Failed to fetch friend requests:', error);
		return c.json({ error: 'Failed to fetch friend requests' }, 500);
	}
});

userRouter.get('/me/search', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const rawQuery = c.req.query('query') || '';
		const query = rawQuery.trim().toLowerCase();

		if (query.length < 2 || !/^[a-z0-9._-]+$/.test(query)) {
			return c.json({ users: [] });
		}

		const matches = await db
			.select({
				id: users.id,
				username: users.username,
				rating: users.rating,
			})
			.from(users)
			.where(
				and(
					sql`lower(${users.username}) like ${`%${query}%`}`,
					sql`${users.id} <> ${uid}`
				)
			)
			.orderBy(
				sql`
					case
						when lower(${users.username}) = ${query} then 0
						when lower(${users.username}) like ${`${query}%`} then 1
						else 2
					end
				`,
				desc(users.rating)
			)
			.limit(8);

		if (matches.length === 0) {
			return c.json({ users: [] });
		}

		const candidateIds = matches.map((user) => user.id);

		const [friendRows, outgoingRows, incomingRows] = await Promise.all([
			db
				.select({ friendId: friendships.friendId })
				.from(friendships)
				.where(and(eq(friendships.userId, uid), inArray(friendships.friendId, candidateIds))),
			db
				.select({ receiverId: friendRequests.receiverId })
				.from(friendRequests)
				.where(
					and(
						eq(friendRequests.senderId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING),
						inArray(friendRequests.receiverId, candidateIds)
					)
				),
			db
				.select({ senderId: friendRequests.senderId })
				.from(friendRequests)
				.where(
					and(
						eq(friendRequests.receiverId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING),
						inArray(friendRequests.senderId, candidateIds)
					)
				),
		]);

		const friendIdSet = new Set(friendRows.map((row) => row.friendId));
		const outgoingIdSet = new Set(outgoingRows.map((row) => row.receiverId));
		const incomingIdSet = new Set(incomingRows.map((row) => row.senderId));

		const searchUsers = matches.map((user) => ({
			...user,
			isFriend: friendIdSet.has(user.id),
			hasOutgoingRequest: outgoingIdSet.has(user.id),
			hasIncomingRequest: incomingIdSet.has(user.id),
		}));

		return c.json({ users: searchUsers });
	} catch (error) {
		console.error('Failed to search users:', error);
		return c.json({ error: 'Failed to search users' }, 500);
	}
});

userRouter.post('/me/friend-requests', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const body = await c.req.json().catch(() => ({}));
		const username = normalizeUsername(body?.username);

		if (!username) {
			return c.json({ error: 'A valid username is required' }, 400);
		}

		const target = await db
			.select({ id: users.id, username: users.username })
			.from(users)
			.where(sql`lower(${users.username}) = ${username}`)
			.limit(1);

		if (target.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		const receiverId = target[0].id;

		if (receiverId === uid) {
			return c.json({ error: 'You cannot add yourself as a friend' }, 400);
		}

		const [alreadyFriends] = await db
			.select({ friendId: friendships.friendId })
			.from(friendships)
			.where(and(eq(friendships.userId, uid), eq(friendships.friendId, receiverId)))
			.limit(1);

		if (alreadyFriends) {
			return c.json({ error: 'You are already friends with this user' }, 409);
		}

		const [existingOutgoing] = await db
			.select({ id: friendRequests.id })
			.from(friendRequests)
			.where(
				and(
					eq(friendRequests.senderId, uid),
					eq(friendRequests.receiverId, receiverId),
					eq(friendRequests.status, FRIEND_REQUEST_PENDING)
				)
			)
			.limit(1);

		if (existingOutgoing) {
			return c.json({ error: 'Friend request already sent' }, 409);
		}

		const [existingIncoming] = await db
			.select({ id: friendRequests.id })
			.from(friendRequests)
			.where(
				and(
					eq(friendRequests.senderId, receiverId),
					eq(friendRequests.receiverId, uid),
					eq(friendRequests.status, FRIEND_REQUEST_PENDING)
				)
			)
			.limit(1);

		if (existingIncoming) {
			await db
				.update(friendRequests)
				.set({
					status: FRIEND_REQUEST_ACCEPTED,
					respondedAt: new Date(),
				})
				.where(eq(friendRequests.id, existingIncoming.id));

			await createFriendshipPair(db, uid, receiverId);

			return c.json({
				message: 'Friend request accepted',
				autoAccepted: true,
				friend: {
					id: receiverId,
					username: target[0].username,
				},
			});
		}

		const requestId = generateEntityId('friend_req');

		await db.insert(friendRequests).values({
			id: requestId,
			senderId: uid,
			receiverId,
			status: FRIEND_REQUEST_PENDING,
			createdAt: new Date(),
			respondedAt: null,
		});

		return c.json({
			message: 'Friend request sent',
			request: {
				id: requestId,
				receiverId,
				receiverUsername: target[0].username,
			},
		});
	} catch (error) {
		console.error('Failed to send friend request:', error);
		return c.json({ error: 'Failed to send friend request' }, 500);
	}
});

userRouter.patch('/me/friend-requests/:requestId', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const requestId = c.req.param('requestId');
		const body = await c.req.json().catch(() => ({}));
		const action = body?.action;

		if (action !== 'accept' && action !== 'decline') {
			return c.json({ error: 'action must be either accept or decline' }, 400);
		}

		const [request] = await db
			.select({
				id: friendRequests.id,
				senderId: friendRequests.senderId,
				receiverId: friendRequests.receiverId,
				status: friendRequests.status,
			})
			.from(friendRequests)
			.where(
				and(
					eq(friendRequests.id, requestId),
					eq(friendRequests.receiverId, uid),
					eq(friendRequests.status, FRIEND_REQUEST_PENDING)
				)
			)
			.limit(1);

		if (!request) {
			return c.json({ error: 'Friend request not found or already handled' }, 404);
		}

		const nextStatus =
			action === 'accept' ? FRIEND_REQUEST_ACCEPTED : FRIEND_REQUEST_DECLINED;

		await db
			.update(friendRequests)
			.set({
				status: nextStatus,
				respondedAt: new Date(),
			})
			.where(eq(friendRequests.id, requestId));

		if (action === 'accept') {
			await createFriendshipPair(db, request.senderId, request.receiverId);
		}

		return c.json({
			message: action === 'accept' ? 'Friend request accepted' : 'Friend request declined',
			request: {
				id: request.id,
				senderId: request.senderId,
				receiverId: request.receiverId,
				status: nextStatus,
			},
		});
	} catch (error) {
		console.error('Failed to handle friend request:', error);
		return c.json({ error: 'Failed to handle friend request' }, 500);
	}
});

userRouter.delete('/me/friends/:friendId', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const friendId = c.req.param('friendId');

		if (!friendId || friendId === uid) {
			return c.json({ error: 'Invalid friend id' }, 400);
		}

		const [friendLink] = await db
			.select({ friendId: friendships.friendId })
			.from(friendships)
			.where(and(eq(friendships.userId, uid), eq(friendships.friendId, friendId)))
			.limit(1);

		if (!friendLink) {
			return c.json({ error: 'Friend not found' }, 404);
		}

		await Promise.all([
			db
				.delete(friendships)
				.where(and(eq(friendships.userId, uid), eq(friendships.friendId, friendId))),
			db
				.delete(friendships)
				.where(and(eq(friendships.userId, friendId), eq(friendships.friendId, uid))),
			db.delete(friendRequests).where(
				and(
					eq(friendRequests.status, FRIEND_REQUEST_PENDING),
					or(
						and(
							eq(friendRequests.senderId, uid),
							eq(friendRequests.receiverId, friendId)
						),
						and(
							eq(friendRequests.senderId, friendId),
							eq(friendRequests.receiverId, uid)
						)
					)
				)
			),
		]);

		return c.json({ message: 'Friend removed successfully' });
	} catch (error) {
		console.error('Failed to remove friend:', error);
		return c.json({ error: 'Failed to remove friend' }, 500);
	}
});

export default userRouter;
