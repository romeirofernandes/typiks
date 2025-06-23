import { Hono } from 'hono';
import { cors } from 'hono/cors';
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

// API routes
app.route('/api/users', userRouter);

// WebSocket upgrade handler using Durable Objects
app.get('/ws', async (c) => {
	const upgradeHeader = c.req.header('upgrade');
	if (upgradeHeader !== 'websocket') {
		return c.text('Expected websocket', 400);
	}

	// Get or create the GameRoom Durable Object
	const id = c.env.GAME_ROOM.idFromName('global-game-room');
	const gameRoom = c.env.GAME_ROOM.get(id);

	// Forward the request to the Durable Object
	return gameRoom.fetch(c.req.raw);
});

export default app;

// Export the Durable Object class
export { GameRoom } from './durable-objects/GameRoom.js';
