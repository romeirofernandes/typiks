import { verifyFirebaseIdToken } from '../middleware/firebaseAuth.js';
import { generateSeed, generateWords, WORD_DIFFICULTIES } from '../utils/wordGenerator.js';

const MAX_PLAYER_INPUT_LENGTH = 32;
const DEFAULT_MODE_SECONDS = 60;
const ALLOWED_MODE_SECONDS = new Set([15, 30, 60, 120]);
const REMATCH_RESPONSE_WINDOW_MS = 10_000;

export class GameRoom {
	constructor(controller, env) {
		this.controller = controller;
		this.env = env;
		this.sessions = new Map(); // sessionId -> WebSocket
		this.sessionOrder = new Map(); // sessionId -> monotonic connection order
		this.waitingPlayersByMode = new Map(); // modeSeconds -> Map(playerId -> waiting payload)
		this.activeGames = new Map(); // gameId -> game data
		this.playerToGame = new Map(); // playerId -> gameId
		this.playerToSession = new Map(); // playerId -> sessionId
		this.rematchOffers = new Map(); // offerId -> rematch offer
		this.playerToRematchOffer = new Map(); // playerId -> offerId
		this.nextSessionOrder = 0;
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

		this.handlePlayerDisconnect(playerId);
		this.playerToSession.delete(playerId);
	}

	clearPlayerRematchOffer(playerId, reason = 'unavailable') {
		const offerId = this.playerToRematchOffer.get(playerId);
		if (!offerId) return;

		const offer = this.rematchOffers.get(offerId);
		if (!offer) {
			this.playerToRematchOffer.delete(playerId);
			return;
		}

		this.clearRematchOffer(offerId, reason);
	}

	clearRematchOffer(offerId, reason = 'expired') {
		const offer = this.rematchOffers.get(offerId);
		if (!offer) return;

		if (offer.responseTimer) {
			clearTimeout(offer.responseTimer);
		}

		this.rematchOffers.delete(offerId);
		this.playerToRematchOffer.delete(offer.player1.id);
		this.playerToRematchOffer.delete(offer.player2.id);

		if (offer.requesterId) {
			this.sendToPlayer(this.playerToSession.get(offer.requesterId), {
				type: reason === 'declined' ? 'REMATCH_DECLINED' : reason === 'timeout' ? 'REMATCH_TIMEOUT' : 'REMATCH_UNAVAILABLE',
			});
		}
	}

	createRematchOfferFromGame(game) {
		const offerId = this.generateEntityId('rematch');
		const offer = {
			id: offerId,
			modeSeconds: game.modeSeconds || DEFAULT_MODE_SECONDS,
			player1: {
				id: game.player1.id,
				userInfo: game.player1.userInfo,
			},
			player2: {
				id: game.player2.id,
				userInfo: game.player2.userInfo,
			},
			requesterId: null,
			responseTimer: null,
		};

		this.rematchOffers.set(offerId, offer);
		this.playerToRematchOffer.set(game.player1.id, offerId);
		this.playerToRematchOffer.set(game.player2.id, offerId);
	}

	handleRematchRequest(playerId) {
		const offerId = this.playerToRematchOffer.get(playerId);
		if (!offerId) return;

		const offer = this.rematchOffers.get(offerId);
		if (!offer || offer.requesterId) return;

		const isPlayer1 = offer.player1.id === playerId;
		const requester = isPlayer1 ? offer.player1 : offer.player2;
		const responder = isPlayer1 ? offer.player2 : offer.player1;

		offer.requesterId = requester.id;

		this.sendToPlayer(this.playerToSession.get(requester.id), {
			type: 'REMATCH_PENDING',
			expiresInMs: REMATCH_RESPONSE_WINDOW_MS,
		});

		this.sendToPlayer(this.playerToSession.get(responder.id), {
			type: 'REMATCH_REQUESTED',
			fromPlayerId: requester.id,
			fromUsername: requester.userInfo.username,
			expiresInMs: REMATCH_RESPONSE_WINDOW_MS,
		});

		offer.responseTimer = setTimeout(() => {
			this.clearRematchOffer(offerId, 'timeout');
		}, REMATCH_RESPONSE_WINDOW_MS);
	}

	handleRematchResponse(playerId, action) {
		const offerId = this.playerToRematchOffer.get(playerId);
		if (!offerId) return;

		const offer = this.rematchOffers.get(offerId);
		if (!offer || !offer.requesterId) return;
		if (action !== 'accept' && action !== 'reject') return;

		const requester = offer.player1.id === offer.requesterId ? offer.player1 : offer.player2;
		const responder = offer.player1.id === playerId ? offer.player1 : offer.player2;
		if (!responder || responder.id === requester.id) return;

		if (action === 'reject') {
			this.clearRematchOffer(offerId, 'declined');
			return;
		}

		const player1SessionId = this.playerToSession.get(offer.player1.id);
		const player2SessionId = this.playerToSession.get(offer.player2.id);
		if (!player1SessionId || !player2SessionId) {
			this.clearRematchOffer(offerId, 'unavailable');
			return;
		}

		if (offer.responseTimer) {
			clearTimeout(offer.responseTimer);
		}

		this.rematchOffers.delete(offerId);
		this.playerToRematchOffer.delete(offer.player1.id);
		this.playerToRematchOffer.delete(offer.player2.id);

		this.createGame(
			offer.player1.id,
			{ sessionId: player1SessionId, userInfo: offer.player1.userInfo, modeSeconds: offer.modeSeconds },
			offer.player2.id,
			{ sessionId: player2SessionId, userInfo: offer.player2.userInfo, modeSeconds: offer.modeSeconds },
			offer.modeSeconds
		);
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

	buildProgressPayload(game) {
		return {
			player1: {
				id: game.player1.id,
				score: game.player1.score,
				currentWordIndex: game.player1.currentWordIndex,
			},
			player2: {
				id: game.player2.id,
				score: game.player2.score,
				currentWordIndex: game.player2.currentWordIndex,
			},
		};
	}

	rebindPlayerToCurrentGame(playerId, sessionId) {
		const gameId = this.playerToGame.get(playerId);
		if (!gameId) return false;

		const game = this.activeGames.get(gameId);
		if (!game) {
			this.playerToGame.delete(playerId);
			return false;
		}

		const isPlayer1 = game.player1.id === playerId;
		const player = isPlayer1 ? game.player1 : game.player2;
		const opponent = isPlayer1 ? game.player2 : game.player1;
		player.sessionId = sessionId;

		this.sendToPlayer(sessionId, {
			type: 'GAME_RESUMED',
			gameId,
			modeSeconds: game.modeSeconds || DEFAULT_MODE_SECONDS,
			status: game.status,
			opponent: {
				id: opponent.id,
				username: opponent.userInfo.username,
				rating: opponent.userInfo.rating,
			},
			words: game.words,
			duration: game.endTime ? Math.max(0, game.endTime - Date.now()) : 0,
			...this.buildProgressPayload(game),
		});

		return true;
	}

	async handleSession(webSocket) {
		webSocket.accept();

		const sessionId = this.generateSessionId();
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

								if (this.rebindPlayerToCurrentGame(playerId, sessionId)) {
									break;
								}

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

					case 'PLAYER_INPUT':
						if (playerId) {
							this.handlePlayerInput(playerId, message.input);
						}
						break;

					case 'REMATCH_REQUEST':
						if (playerId) {
							this.handleRematchRequest(playerId);
						}
						break;

					case 'REMATCH_RESPONSE':
						if (playerId) {
							this.handleRematchResponse(playerId, message.action);
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

	generateSessionId() {
		return this.generateEntityId('session');
	}

	addWaitingPlayer(playerId, sessionId, userInfo, modeSeconds = DEFAULT_MODE_SECONDS) {
		this.clearPlayerRematchOffer(playerId);
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

			this.createGame(player1Id, player1Data, player2Id, player2Data, modeSeconds);
		}
	}

	createGame(player1Id, player1Data, player2Id, player2Data, modeSeconds = DEFAULT_MODE_SECONDS) {
		this.clearPlayerRematchOffer(player1Id);
		this.clearPlayerRematchOffer(player2Id);

		const gameId = this.generateEntityId('game');
		const wordSeed = generateSeed();
		const difficulty = WORD_DIFFICULTIES.medium;
		const normalizedModeSeconds = this.normalizeModeSeconds(modeSeconds);
		const words = generateWords(
			wordSeed,
			difficulty,
			Math.max(18, Math.round(normalizedModeSeconds * 0.75))
		);

		const game = {
			id: gameId,
			difficulty,
			modeSeconds: normalizedModeSeconds,
			player1: {
				id: player1Id,
				sessionId: player1Data.sessionId,
				userInfo: player1Data.userInfo,
				score: 0,
				currentWordIndex: 0,
			},
			player2: {
				id: player2Id,
				sessionId: player2Data.sessionId,
				userInfo: player2Data.userInfo,
				score: 0,
				currentWordIndex: 0,
			},
			words,
			status: 'countdown',
			startTime: null,
			endTime: null,
			gameTimer: null,
		};

		this.activeGames.set(gameId, game);
		this.playerToGame.set(player1Id, gameId);
		this.playerToGame.set(player2Id, gameId);

		this.sendToPlayer(player1Data.sessionId, {
			type: 'MATCH_FOUND',
			gameId,
			modeSeconds: normalizedModeSeconds,
			opponent: {
				id: player2Id,
				username: player2Data.userInfo.username,
				rating: player2Data.userInfo.rating,
			},
		});

		this.sendToPlayer(player2Data.sessionId, {
			type: 'MATCH_FOUND',
			gameId,
			modeSeconds: normalizedModeSeconds,
			opponent: {
				id: player1Id,
				username: player1Data.userInfo.username,
				rating: player1Data.userInfo.rating,
			},
		});

		this.startCountdown(gameId);
	}

	startCountdown(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		let count = 3;

		this.sendToPlayers(game, {
			type: 'COUNTDOWN',
			count: count,
		});

		const countdown = setInterval(() => {
			count--;

			if (count > 0) {
				this.sendToPlayers(game, {
					type: 'COUNTDOWN',
					count: count,
				});
			} else {
				// Send GO! message
				this.sendToPlayers(game, {
					type: 'COUNTDOWN',
					count: 0,
				});

				clearInterval(countdown);

				setTimeout(() => {
					this.startGame(gameId);
				}, 500);
			}
		}, 1000);
	}

	startGame(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game) return;
		const durationMs = (game.modeSeconds || DEFAULT_MODE_SECONDS) * 1000;

		game.status = 'playing';
		game.startTime = Date.now();
		game.endTime = game.startTime + durationMs;

		this.sendToPlayers(game, {
			type: 'GAME_START',
			words: game.words,
			difficulty: game.difficulty,
			modeSeconds: game.modeSeconds,
			duration: durationMs,
			startTime: game.startTime,
		});

		game.gameTimer = setTimeout(() => {
			this.endGame(gameId, 'timeout');
		}, durationMs);
	}

	handlePlayerInput(playerId, input) {
		if (typeof input !== 'string') return;

		const normalizedInput = input.trim().toLowerCase();
		if (!normalizedInput || normalizedInput.length > MAX_PLAYER_INPUT_LENGTH) return;

		const gameId = this.playerToGame.get(playerId);
		if (!gameId) return;

		const game = this.activeGames.get(gameId);
		if (!game || game.status !== 'playing') return;

		const isPlayer1 = game.player1.id === playerId;
		const player = isPlayer1 ? game.player1 : game.player2;

		const currentWord = game.words[player.currentWordIndex];
		if (typeof currentWord !== 'string') {
			this.endGame(gameId, 'completed');
			return;
		}

		if (normalizedInput === currentWord.toLowerCase()) {
			player.score++;
			player.currentWordIndex++;

			this.sendToPlayers(game, {
				type: 'PLAYER_PROGRESS',
				...this.buildProgressPayload(game),
			});

			if (player.currentWordIndex >= game.words.length) {
				this.endGame(gameId, 'completed');
			}
		} else {
			this.sendToPlayer(this.playerToSession.get(playerId), {
				type: 'WRONG_WORD',
			});
		}
	}

	endGame(gameId, reason = 'timeout', options = {}) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		if (game.gameTimer) {
			clearTimeout(game.gameTimer);
		}

		game.status = 'finished';

		let winner = null;

		if (reason === 'opponent_disconnected') {
			const disconnectedPlayerId = options?.disconnectedPlayerId;
			if (disconnectedPlayerId === game.player1.id) {
				winner = 'player2';
			} else if (disconnectedPlayerId === game.player2.id) {
				winner = 'player1';
			}
		}

		if (!winner) {
			if (game.player1.score > game.player2.score) {
				winner = 'player1';
			} else if (game.player2.score > game.player1.score) {
				winner = 'player2';
			} else {
				if (game.player1.currentWordIndex > game.player2.currentWordIndex) {
					winner = 'player1';
				} else if (game.player2.currentWordIndex > game.player1.currentWordIndex) {
					winner = 'player2';
				}
			}
		}

		const player1Won = winner === 'player1';
		const player2Won = winner === 'player2';
		const isDraw = winner === null;

		this.sendToPlayers(game, {
			type: 'GAME_END',
			results: {
				gameId,
				modeSeconds: game.modeSeconds || DEFAULT_MODE_SECONDS,
				player1: {
					id: game.player1.id,
					username: game.player1.userInfo.username,
					score: game.player1.score,
					progress: game.player1.currentWordIndex,
					won: player1Won,
				},
				player2: {
					id: game.player2.id,
					username: game.player2.userInfo.username,
					score: game.player2.score,
					progress: game.player2.currentWordIndex,
					won: player2Won,
				},
				isDraw,
				reason,
			},
		});

		this.playerToGame.delete(game.player1.id);
		this.playerToGame.delete(game.player2.id);
		this.activeGames.delete(gameId);

		if (reason !== 'opponent_disconnected') {
			this.createRematchOfferFromGame(game);
		}
	}

	handlePlayerDisconnect(playerId) {
		this.clearPlayerRematchOffer(playerId);
		this.removeWaitingPlayer(playerId);

		const gameId = this.playerToGame.get(playerId);
		if (gameId) {
			const game = this.activeGames.get(gameId);
			if (game) {
				this.endGame(gameId, 'opponent_disconnected', {
					disconnectedPlayerId: playerId,
				});
				return;
			}

			this.playerToGame.delete(playerId);
		}
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

	sendToPlayers(game, message) {
		this.sendToPlayer(game.player1.sessionId, message);
		this.sendToPlayer(game.player2.sessionId, message);
	}
}
