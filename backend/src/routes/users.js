import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { calculateNewRatings } from '../utils/rating.js';
import { requireFirebaseAuth } from '../middleware/firebaseAuth.js';

const userRouter = new Hono();

const requireAuth = requireFirebaseAuth();

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
		const { won, opponentId, score, opponentScore } = await c.req.json();
		if (typeof opponentId !== 'string' || opponentId.length === 0) {
			return c.json({ error: 'opponentId is required' }, 400);
		}
		if (opponentId === uid) {
			return c.json({ error: 'opponentId must be different from player id' }, 400);
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

		// Calculate new ratings
		const newPlayerRating = calculateNewRatings(playerData.rating, opponentData.rating, won);
		const newOpponentRating = calculateNewRatings(opponentData.rating, playerData.rating, !won);

		// Update both players
		const [updatedPlayer, updatedOpponent] = await Promise.all([
			db
				.update(users)
				.set({
					gamesPlayed: playerData.gamesPlayed + 1,
					gamesWon: won ? playerData.gamesWon + 1 : playerData.gamesWon,
					gamesLost: !won ? playerData.gamesLost + 1 : playerData.gamesLost,
					rating: newPlayerRating,
				})
				.where(eq(users.id, uid))
				.returning(),

			db
				.update(users)
				.set({
					gamesPlayed: opponentData.gamesPlayed + 1,
					gamesWon: !won ? opponentData.gamesWon + 1 : opponentData.gamesWon,
					gamesLost: won ? opponentData.gamesLost + 1 : opponentData.gamesLost,
					rating: newOpponentRating,
				})
				.where(eq(users.id, opponentId))
				.returning(),
		]);

		return c.json({
			player: updatedPlayer[0],
			opponent: updatedOpponent[0],
			ratingChange: newPlayerRating - playerData.rating,
			opponentRatingChange: newOpponentRating - opponentData.rating,
		});
	} catch (error) {
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

		const stats = user[0];
		const winRate = stats.gamesPlayed > 0 ? ((stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1) : 0;

		return c.json({
			...stats,
			winRate: parseFloat(winRate),
		});
	} catch (error) {
		return c.json({ error: 'Failed to fetch user stats' }, 500);
	}
});

export default userRouter;
