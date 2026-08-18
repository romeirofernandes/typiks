import { Hono } from 'hono';
import { requireFirebaseAuth } from '../middleware/firebaseAuth.js';
import { logger } from '../services/logger.js';

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
	const bytes = new Uint8Array(ROOM_CODE_LENGTH);
	crypto.getRandomValues(bytes);
	let code = '';
	for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
		// getRandomValues bytes are uniform in [0, 256); rejection-free bias
		// of <1% is acceptable for a 6-char room code, but keep it minimal by
		// masking to the nearest power of two above the alphabet length.
		code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
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

function sanitizeRoomCode(rawRoomCode) {
	if (typeof rawRoomCode !== 'string') return null;
	const code = rawRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	return code.length === 6 ? code : null;
}

function normalizeRoomSettings(rawSettings = {}) {
	const maxPlayers = coerceInteger(rawSettings.maxPlayers, ROOM_LIMITS.maxPlayers);
	const roundTimeSeconds = coerceInteger(rawSettings.roundTimeSeconds, 60);
	const wordCount = coerceInteger(rawSettings.wordCount, 30);
	const gameMode = rawSettings.gameMode === 'coop' ? 'coop' : 'ffa';
	const coopMode = rawSettings.coopMode === 'switcher' ? 'switcher' : 'normal';

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
			coopMode,
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
				logger.error('Failed to configure private room', {
					status: configureResponse.status,
					payload,
				});
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
		logger.error('Failed to create room', { error: error?.message });
		return c.json({ error: 'Failed to create room' }, 500);
	}
});

// Public: check whether a room is joinable before the visitor signs in. No
// auth — a link visitor has no token yet. Do NOT attach requireFirebaseAuth.
roomsRouter.get('/:code/status', async (c) => {
	try {
		const code = sanitizeRoomCode(c.req.param('code'));
		if (!code) {
			return c.json({ error: 'Invalid room code' }, 400);
		}

		const roomId = c.env.PRIVATE_ROOM.idFromName(`room-${code}`);
		const roomStub = c.env.PRIVATE_ROOM.get(roomId);

		const statusRequest = new Request('https://private-room.internal/status', {
			method: 'GET',
		});
		const statusResponse = await roomStub.fetch(statusRequest);
		const payload = await statusResponse.json().catch(() => null);

		return c.json(
			payload && typeof payload === 'object' ? payload : { code, exists: false },
			statusResponse.ok ? 200 : 502
		);
	} catch (error) {
		logger.error('Failed to check room status', { error: error?.message });
		return c.json({ error: 'Failed to check room status' }, 500);
	}
});

export default roomsRouter;
