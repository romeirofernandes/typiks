import { verifyFirebaseIdToken } from '../middleware/firebaseAuth.js';
import { DEFAULT_MODE_SECONDS, ALLOWED_MODE_SECONDS } from './GameRoom.js';
import { resolveServerProfiles } from '../utils/serverProfiles.js';

const PENDING_GAME_TTL_MS = 60_000;

// MatchmakingRoom is a SINGLE Durable Object instance ('global-matchmaker') that
// owns the ranked queue. It only matches players and hands each match off to a
// dedicated GameRoom instance. Queue traffic (JOIN_QUEUE / MATCH_FOUND) is tiny
// compared to in-game message traffic, so a single instance is not a bottleneck.
export class MatchmakingRoom {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.sessions = new Map(); // sessionId -> WebSocket
		this.sessionOrder = new Map(); // sessionId -> monotonic connection order
		this.waitingPlayersByMode = new Map(); // modeSeconds -> Map(playerId -> waiting payload)
		this.playerToSession = new Map(); // playerId -> sessionId
		this.nextSessionOrder = 0;
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

	async authenticateAndGetPlayerId(message) {
		const idToken = message?.idToken;
		if (typeof idToken !== 'string' || idToken.length === 0) {
			throw new Error('Missing idToken');
		}
		const claims = await verifyFirebaseIdToken(idToken, {
			projectId: this.env.FIREBASE_PROJECT_ID,
		});
		return claims.uid;
	}

	sanitizeUserInfo(userInfo) {
		const safe = {
			username: 'player',
			rating: 800,
			avatarId: 'avatar1',
		};
		if (!userInfo || typeof userInfo !== 'object') return safe;
		if (typeof userInfo.username === 'string' && userInfo.username.trim().length > 0) {
			safe.username = userInfo.username.trim().slice(0, 32);
		}
		const parsedRating = Number(userInfo.rating);
		if (Number.isFinite(parsedRating)) {
			safe.rating = Math.max(0, Math.min(3000, Math.floor(parsedRating)));
		}
		if (typeof userInfo.avatarId === 'string' && /^avatar([1-9]|10)$/.test(userInfo.avatarId.trim().toLowerCase())) {
			safe.avatarId = userInfo.avatarId.trim().toLowerCase();
		}
		return safe;
	}

	async fetch(request) {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.handleSession(server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	parseMessage(data) {
		if (typeof data !== 'string') return null;

		try {
			const parsed = JSON.parse(data);
			if (!parsed || typeof parsed !== 'object') {
				return null;
			}
			return parsed;
		} catch {
			return null;
		}
	}

	generateEntityId(prefix) {
		if (typeof crypto?.randomUUID === 'function') {
			return `${prefix}_${crypto.randomUUID()}`;
		}

		return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
	}

	isSocketOpen(webSocket) {
		if (!webSocket) return false;

		const openStates = [WebSocket.OPEN, WebSocket.READY_STATE_OPEN, 1].filter((state) => Number.isFinite(state));
		return openStates.includes(webSocket.readyState);
	}

	handleSessionTermination(sessionId, playerId) {
		this.sessions.delete(sessionId);
		this.sessionOrder.delete(sessionId);

		if (!playerId) {
			return;
		}

		const ownedSessionId = this.playerToSession.get(playerId);
		if (ownedSessionId !== sessionId) {
			return;
		}

		this.removeWaitingPlayer(playerId);
		this.playerToSession.delete(playerId);
	}

	closeSession(sessionId, code = 1000, reason = 'Session replaced') {
		const previousSocket = this.sessions.get(sessionId);
		if (!previousSocket) {
			return;
		}

		try {
			previousSocket.close(code, reason);
		} catch {
			// ignore close errors from stale sockets
		}

		this.sessions.delete(sessionId);
		this.sessionOrder.delete(sessionId);
	}

	getSessionOrder(sessionId) {
		return this.sessionOrder.get(sessionId) ?? -1;
	}

	async handleSession(webSocket) {
		webSocket.accept();

		const sessionId = this.generateEntityId('session');
		this.sessions.set(sessionId, webSocket);
		this.sessionOrder.set(sessionId, this.nextSessionOrder++);

		let playerId = null;

		webSocket.addEventListener('message', async (event) => {
			try {
				const message = this.parseMessage(event.data);
				if (!message || typeof message.type !== 'string') {
					return;
				}

				switch (message.type) {
					case 'JOIN_QUEUE':
						try {
							playerId = await this.authenticateAndGetPlayerId(message);

							const previousSessionId = this.playerToSession.get(playerId);
							if (
								previousSessionId &&
								previousSessionId !== sessionId &&
								this.getSessionOrder(previousSessionId) > this.getSessionOrder(sessionId)
							) {
								this.closeSession(sessionId, 1000, 'Superseded by newer session');
								break;
							}

							if (previousSessionId && previousSessionId !== sessionId) {
								this.closeSession(previousSessionId, 1000, 'Replaced by newer session');
							}

							this.playerToSession.set(playerId, sessionId);

							const modeSeconds = this.normalizeModeSeconds(message.modeSeconds);
							this.addWaitingPlayer(
								playerId,
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
							this.playerToSession.delete(playerId);
						}
						break;

					default:
						break;
				}
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
			}
		});

		webSocket.addEventListener('close', () => {
			this.handleSessionTermination(sessionId, playerId);
		});

		webSocket.addEventListener('error', (error) => {
			console.error('WebSocket error:', error);
			this.handleSessionTermination(sessionId, playerId);
		});
	}

	addWaitingPlayer(playerId, sessionId, userInfo, modeSeconds = DEFAULT_MODE_SECONDS) {
		this.removeWaitingPlayer(playerId);

		const queue = this.getQueueForMode(modeSeconds);
		queue.set(playerId, { sessionId, userInfo, modeSeconds });
		console.log(
			`Player ${playerId} added to waiting queue (${modeSeconds}s). Queue size: ${queue.size}`
		);

		this.tryToMatch(modeSeconds);
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

	tryToMatch(modeSeconds = DEFAULT_MODE_SECONDS) {
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

			this.createMatch(player1Id, player1Data, player2Id, player2Data, modeSeconds);
		}
	}

	async createMatch(player1Id, player1Data, player2Id, player2Data, modeSeconds = DEFAULT_MODE_SECONDS) {
		const gameId = this.generateEntityId('game');
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
				avatarId: player2Profile.avatarId,
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
				avatarId: player1Profile.avatarId,
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

	sendToPlayer(sessionId, message) {
		if (typeof sessionId !== 'string' || sessionId.length === 0) {
			return;
		}

		const webSocket = this.sessions.get(sessionId);
		if (this.isSocketOpen(webSocket)) {
			try {
				webSocket.send(JSON.stringify(message));
			} catch (error) {
				console.error('Error sending message:', error);
			}
		}
	}
}
