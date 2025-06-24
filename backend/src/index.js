import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import { users } from './db/schema.js';
import userRouter from './routes/users.js';

const app = new Hono();

app.use(
	'*',
	cors({
		origin: ['https://typiks.vercel.app', 'http://localhost:5173'],
		credentials: true,
	})
);

app.get('/', (c) => {
	return c.text('Typiks Backend API');
});

// Get platform stats
app.get('/api/stats', async (c) => {
	try {
		const db = drizzle(c.env.DB);

		const result = await db
			.select({
				totalGames: sql`sum(${users.gamesPlayed})`.as('total_games'),
				totalUsers: sql`count(*)`.as('total_users'),
			})
			.from(users);

		const stats = result[0];

		return c.json({
			totalGames: stats.totalGames || 0,
			totalUsers: stats.totalUsers || 0,
		});
	} catch (error) {
		console.error('Failed to fetch platform stats:', error);
		return c.json({ error: 'Failed to fetch stats' }, 500);
	}
});

// API routes
app.route('/api/users', userRouter);

app.get('/ws', async (c) => {
	const upgradeHeader = c.req.header('upgrade');
	if (upgradeHeader !== 'websocket') {
		return c.text('Expected websocket', 400);
	}

	const id = c.env.GAME_ROOM.idFromName('global-game-room');
	const gameRoom = c.env.GAME_ROOM.get(id);

	return gameRoom.fetch(c.req.raw);
});

export default app;

export { GameRoom } from './durable-objects/GameRoom.js';
