import { DEFAULT_MODE_SECONDS, ALLOWED_MODE_SECONDS } from './GameRoom.js';
import { resolveServerProfiles } from '../utils/serverProfiles.js';
import { generateEntityId as createId } from '../services/ids.js';
import { WSCoordinator } from './WSCoordinator.js';

const PENDING_GAME_TTL_MS = 60_000;

// MatchmakingRoom is a SINGLE Durable Object instance ('global-matchmaker') that
// owns the ranked queue. It only matches players and hands each match off to a
// dedicated GameRoom instance. Queue traffic (JOIN_QUEUE / MATCH_FOUND) is tiny
// compared to in-game message traffic, so a single instance is not a bottleneck.
export class MatchmakingRoom extends WSCoordinator {
	constructor(state, env) {
		super(state, env);

		this.waitingPlayersByMode = new Map(); // modeSeconds -> Map(playerId -> waiting payload)
		this.pendingGames = new Map(); // gameId -> { expiresAt }
	}

	normalizeModeSeconds(rawModeSeconds) {
		const parsed = Number.parseInt(String(rawModeSeconds), 10);
		if (!Number.isFinite(parsed) || !ALLOWED_MODE_SECONDS.has(parsed)) {
			return DEFAULT_MODE_SECONDS;
		}

		return parsed;
	}

	getQueueForMode(modeSeconds) {
		if (!this.waitingPlayersByMode.has(modeSeconds)) {
			this.waitingPlayersByMode.set(modeSeconds, new Map());
		}

		return this.waitingPlayersByMode.get(modeSeconds);
	}

	sanitizeUserInfo(userInfo) {
		const safe = {
			username: 'player',
			rating: 800,
		};
		if (!userInfo || typeof userInfo !== 'object') return safe;
		if (typeof userInfo.username === 'string' && userInfo.username.trim().length > 0) {
			safe.username = userInfo.username.trim().slice(0, 32);
		}
		const parsedRating = Number(userInfo.rating);
		if (Number.isFinite(parsedRating)) {
			safe.rating = Math.max(0, Math.min(3000, Math.floor(parsedRating)));
		}
		return safe;
	}

	async fetch(request) {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.handleSession(server, request);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	// ----- WebSocket session handling ---------------------------------------

	async handleMessage(message, ctx) {
		const { sessionId, webSocket, getPlayerId, setPlayerId } = ctx;
		const playerId = getPlayerId();

		switch (message.type) {
			case 'JOIN_QUEUE':
				try {
					const joinedPlayerId = await this.authenticateAndGetPlayerId(message);

					if (!this.claimSession(joinedPlayerId, sessionId)) {
						break;
					}

					setPlayerId(joinedPlayerId);

					const modeSeconds = this.normalizeModeSeconds(message.modeSeconds);
					await this.addWaitingPlayer(
						joinedPlayerId,
						sessionId,
						this.sanitizeUserInfo(message.userInfo),
						modeSeconds
					);
				} catch (error) {
					console.error('JOIN_QUEUE auth failed:', error);
					try {
						webSocket.send(JSON.stringify({ type: 'ERROR', error: 'UNAUTHORIZED' }));
					} catch {
						// ignore
					}
					webSocket.close(1008, 'Unauthorized');
				}
				break;

			case 'LEAVE_QUEUE':
				if (playerId) {
					this.removeWaitingPlayer(playerId);
				}
				break;

			default:
				break;
		}
	}

	handlePlayerDisconnect(playerId) {
		this.removeWaitingPlayer(playerId);
	}

	async addWaitingPlayer(playerId, sessionId, userInfo, modeSeconds = DEFAULT_MODE_SECONDS) {
		this.removeWaitingPlayer(playerId);

		const queue = this.getQueueForMode(modeSeconds);
		queue.set(playerId, { sessionId, userInfo, modeSeconds });
		console.log(
			`Player ${playerId} added to waiting queue (${modeSeconds}s). Queue size: ${queue.size}`
		);

		await this.tryToMatch(modeSeconds);
	}

	removeWaitingPlayer(playerId) {
		for (const [modeSeconds, queue] of this.waitingPlayersByMode.entries()) {
			if (queue.delete(playerId)) {
				if (queue.size === 0) {
					this.waitingPlayersByMode.delete(modeSeconds);
				}
				console.log(`Player ${playerId} removed from waiting queue (${modeSeconds}s)`);
				return;
			}
		}
	}

	async tryToMatch(modeSeconds = DEFAULT_MODE_SECONDS) {
		const queue = this.getQueueForMode(modeSeconds);
		if (queue.size >= 2) {
			const players = Array.from(queue.entries()).slice(0, 2);
			const [player1Id, player1Data] = players[0];
			const [player2Id, player2Data] = players[1];

			queue.delete(player1Id);
			queue.delete(player2Id);
			if (queue.size === 0) {
				this.waitingPlayersByMode.delete(modeSeconds);
			}

			await this.createMatch(player1Id, player1Data, player2Id, player2Data, modeSeconds);
		}
	}

	async createMatch(player1Id, player1Data, player2Id, player2Data, modeSeconds = DEFAULT_MODE_SECONDS) {
		const gameId = createId("game");
		const normalizedModeSeconds = this.normalizeModeSeconds(modeSeconds);

		// Opponents see server-trusted profiles from D1, never client-asserted
		// userInfo. Unknown players resolve to neutral defaults.
		const profiles = await resolveServerProfiles(this.env, [player1Id, player2Id]);
		const player1Profile = profiles[player1Id];
		const player2Profile = profiles[player2Id];

		const match = {
			gameId,
			modeSeconds: normalizedModeSeconds,
			player1: {
				id: player1Id,
				userInfo: player1Profile,
			},
			player2: {
				id: player2Id,
				userInfo: player2Profile,
			},
			createdAt: Date.now(),
		};

		try {
			const stub = this.env.GAME_ROOM.get(
				this.env.GAME_ROOM.idFromName(`game-${gameId}`)
			);
			const response = await stub.fetch('https://typiks/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(match),
			});

			// The room is only handed off once it acknowledges a durable seed.
			if (!response.ok) {
				console.error(
					`Game room init failed with ${response.status}, requeueing players:`
				);
				this.getQueueForMode(normalizedModeSeconds).set(player1Id, player1Data);
				this.getQueueForMode(normalizedModeSeconds).set(player2Id, player2Data);
				return;
			}
		} catch (error) {
			console.error('Failed to initialize game room, requeueing players:', error);
			this.getQueueForMode(normalizedModeSeconds).set(player1Id, player1Data);
			this.getQueueForMode(normalizedModeSeconds).set(player2Id, player2Data);
			return;
		}

		this.sendToPlayer(player1Data.sessionId, {
			type: 'MATCH_FOUND',
			gameId,
			modeSeconds: normalizedModeSeconds,
			opponent: {
				id: player2Id,
				username: player2Profile.username,
				rating: player2Profile.rating,
			},
		});

		this.sendToPlayer(player2Data.sessionId, {
			type: 'MATCH_FOUND',
			gameId,
			modeSeconds: normalizedModeSeconds,
			opponent: {
				id: player1Id,
				username: player1Profile.username,
				rating: player1Profile.rating,
			},
		});

		this.trackPendingGame(gameId);
	}

	trackPendingGame(gameId) {
		this.pendingGames.set(gameId, { expiresAt: Date.now() + PENDING_GAME_TTL_MS });
		setTimeout(() => {
			this.pendingGames.delete(gameId);
		}, PENDING_GAME_TTL_MS);
	}
}
