import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { calculateNewRatings } from '../utils/rating.js';

const userRouter = new Hono();

userRouter.post('/', async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const body = await c.req.json();
		const { uid, email, username } = body;

		const existingUser = await db.select().from(users).where(eq(users.id, uid)).limit(1);

		if (existingUser.length > 0) {
			return c.json({ user: existingUser[0], message: 'User already exists' });
		}

		const newUser = await db
			.insert(users)
			.values({
				id: uid,
				username,
				email,
				gamesPlayed: 0,
				gamesWon: 0,
				gamesLost: 0,
				rating: 800, // Default rating
				createdAt: new Date(),
			})
			.returning();

		return c.json({ user: newUser[0], message: 'User created successfully' });
	} catch (error) {
		return c.json({ error: 'Failed to create user', details: error.message }, 500);
	}
});

userRouter.get('/:id', async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');

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
userRouter.patch('/:id/game-result', async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const { won, opponentId, score, opponentScore } = await c.req.json();

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

userRouter.get('/:id/stats', async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');

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

// Get leaderboard (top 10 players by rating)
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

		// Add ranking numbers
		const leaderboard = topPlayers.map((player, index) => ({
			rank: index + 1,
			...player,
			winRate: player.gamesPlayed > 0 ? ((player.gamesWon / player.gamesPlayed) * 100).toFixed(1) : 0,
		}));

		return c.json({ leaderboard });
	} catch (error) {
		return c.json({ error: 'Failed to fetch leaderboard' }, 500);
	}
});

export default userRouter;
