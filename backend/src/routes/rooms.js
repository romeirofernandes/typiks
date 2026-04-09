import { Hono } from 'hono';
import { requireFirebaseAuth } from '../middleware/firebaseAuth.js';

const roomsRouter = new Hono();

const requireAuth = requireFirebaseAuth();

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const ROOM_LIMITS = {
	minPlayers: 2,
	maxPlayers: 8,
	minRoundTimeSeconds: 20,
	maxRoundTimeSeconds: 300,
	minWordCount: 10,
	maxWordCount: 120,
};

function generateRoomCode() {
	let code = '';
	for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
		const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
		code += ROOM_CODE_ALPHABET[idx];
	}
	return code;
}

function coerceInteger(value, fallback) {
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return parsed;
}

function normalizeRoomSettings(rawSettings = {}) {
	const maxPlayers = coerceInteger(rawSettings.maxPlayers, ROOM_LIMITS.maxPlayers);
	const roundTimeSeconds = coerceInteger(rawSettings.roundTimeSeconds, 60);
	const wordCount = coerceInteger(rawSettings.wordCount, 30);
	const gameMode = rawSettings.gameMode === 'coop' ? 'coop' : 'ffa';

	if (maxPlayers < ROOM_LIMITS.minPlayers || maxPlayers > ROOM_LIMITS.maxPlayers) {
		return {
			error: `maxPlayers must be between ${ROOM_LIMITS.minPlayers} and ${ROOM_LIMITS.maxPlayers}`,
		};
	}

	if (
		roundTimeSeconds < ROOM_LIMITS.minRoundTimeSeconds ||
		roundTimeSeconds > ROOM_LIMITS.maxRoundTimeSeconds
	) {
		return {
			error: `roundTimeSeconds must be between ${ROOM_LIMITS.minRoundTimeSeconds} and ${ROOM_LIMITS.maxRoundTimeSeconds}`,
		};
	}

	if (wordCount < ROOM_LIMITS.minWordCount || wordCount > ROOM_LIMITS.maxWordCount) {
		return {
			error: `wordCount must be between ${ROOM_LIMITS.minWordCount} and ${ROOM_LIMITS.maxWordCount}`,
		};
	}

	return {
		settings: {
			maxPlayers,
			roundTimeSeconds,
			wordCount,
			gameMode,
		},
	};
}

roomsRouter.post('/', requireAuth, async (c) => {
	try {
		const auth = c.get('auth');
		if (!auth?.uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const body = await c.req.json().catch(() => ({}));
		const normalized = normalizeRoomSettings(body);
		if (normalized.error) {
			return c.json({ error: normalized.error }, 400);
		}

		let attempts = 0;
		while (attempts < 8) {
			attempts++;
			const roomCode = generateRoomCode();
			const roomId = c.env.PRIVATE_ROOM.idFromName(`room-${roomCode}`);
			const roomStub = c.env.PRIVATE_ROOM.get(roomId);

			const configureRequest = new Request('https://private-room.internal/configure', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					roomCode,
					ownerId: auth.uid,
					settings: normalized.settings,
				}),
			});

			const configureResponse = await roomStub.fetch(configureRequest);
			if (configureResponse.status === 409) {
				continue;
			}

			if (!configureResponse.ok) {
				const payload = await configureResponse.text().catch(() => '');
				console.error('Failed to configure private room:', configureResponse.status, payload);
				return c.json({ error: 'Failed to create room' }, 500);
			}

			return c.json({
				roomCode,
				leaderId: auth.uid,
				settings: normalized.settings,
			});
		}

		return c.json({ error: 'Unable to allocate a room code, please retry' }, 503);
	} catch (error) {
		console.error('Failed to create room:', error);
		return c.json({ error: 'Failed to create room' }, 500);
	}
});

export default roomsRouter;
