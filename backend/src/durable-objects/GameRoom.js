import { verifyFirebaseIdToken } from '../middleware/firebaseAuth.js';
import { generateSeed, generateWords, WORD_DIFFICULTIES } from '../utils/wordGenerator.js';
import { resolveServerProfiles } from '../utils/serverProfiles.js';
import { generateEntityId as createId } from '../services/ids.js';
import { persistRankedMatchResult } from '../services/match-results.js';
import { drizzle } from 'drizzle-orm/d1';

export const DEFAULT_MODE_SECONDS = 60;
export const ALLOWED_MODE_SECONDS = new Set([15, 30, 60]);

const MAX_PLAYER_INPUT_LENGTH = 32;
const REMATCH_RESPONSE_WINDOW_MS = 10_000;
const MATCH_WAIT_TIMEOUT_MS = 20_000;
const ROOM_STATE_KEY = 'roomState';
const COUNTDOWN_TOTAL_MS = 3500;
const GO_DELAY_MS = 500;
const PROGRESS_PERSIST_INTERVAL_MS = 1000;

const PHASE = {
	WAITING_FOR_PLAYERS: 'waiting_for_players',
	COUNTDOWN: 'countdown',
	PLAYING: 'playing',
	FINISHED: 'finished',
	ABORTED: 'aborted',
};

// GameRoom is a Durable Object that runs ONE ranked match (plus any rematches).
// Matchmaking (the queue) lives in MatchmakingRoom. When two players are paired,
// the matchmaker seeds this instance with the match via POST /init, then each
// player reconnects to /ws/game/:gameId and sends JOIN_GAME. Sharding by
// idFromName(`game-${gameId}`) means match throughput is not limited by a
// single shared instance.
//
// Persistence & recovery: every lifecycle mutation is snapshotted into a single
// `roomState` key. The phase machine (waiting_for_players -> countdown ->
// playing -> finished, or -> aborted) plus the pending alarm purpose is enough
// to resume correctly after a restart/eviction. The 20s handoff timeout uses a
// Durable Object alarm (restart-safe) rather than setTimeout.
export class GameRoom {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.storage = state?.storage ?? null;

		// Persisted lifecycle state (mirrored in `roomState` storage key).
		this.match = null; // { gameId, modeSeconds, player1:{id,userInfo}, player2:{id,userInfo}, createdAt }
		this.phase = PHASE.WAITING_FOR_PLAYERS;
		this.waitDeadline = null; // absolute ms the handoff wait expires
		this.alarmPurpose = null; // 'wait' | 'game_end' | 'rematch_response'
		this.alarmDeadline = null;
		this.lastResults = null; // results of the most recently finished round
		this.rematchState = { offerId: null, requesterId: null, expiresAt: null };

		// Ephemeral connection / in-memory round state.
		this.sessions = new Map(); // sessionId -> WebSocket
		this.sessionOrder = new Map(); // sessionId -> monotonic connection order
		this.playerToSession = new Map(); // playerId -> sessionId
		this.connectedPlayers = new Set(); // playerIds who have JOIN_GAME'd
		this.activeGames = new Map(); // gameId -> active round data
		this.playerToGame = new Map(); // playerId -> gameId
		this.rematchOffers = new Map(); // offerId -> rematch offer
		this.playerToRematchOffer = new Map(); // playerId -> offerId
		this.nextSessionOrder = 0;
		this.hydrated = false;
		this.lastProgressPersistAt = 0;
	}

	normalizeModeSeconds(rawModeSeconds) {
		const parsed = Number.parseInt(String(rawModeSeconds), 10);
		if (!Number.isFinite(parsed) || !ALLOWED_MODE_SECONDS.has(parsed)) {
			return DEFAULT_MODE_SECONDS;
		}

		return parsed;
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

	jsonResponse(body, status = 200) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ----- Persistence & recovery -------------------------------------------

	buildRoomState() {
		const activeGame =
			this.activeGames.size === 1 ? this.activeGames.values().next().value : null;

		return {
			match: this.match,
			phase: this.phase,
			waitDeadline: this.waitDeadline,
			alarm:
				this.alarmPurpose && this.alarmDeadline
					? { purpose: this.alarmPurpose, deadline: this.alarmDeadline }
					: null,
			round: activeGame ? this.serializeRound(activeGame) : null,
			results: this.lastResults,
			rematch: this.rematchState,
		};
	}

	serializeRound(game) {
		return {
			id: game.id,
			difficulty: game.difficulty,
			seed: game.seed,
			modeSeconds: game.modeSeconds,
			status: game.status,
			startTime: game.startTime,
			endTime: game.endTime,
			countdownStart: game.countdownStart,
			words: game.words,
			player1: { ...game.player1 },
			player2: { ...game.player2 },
		};
	}

	async persistRoomState() {
		if (!this.storage?.put) return;
		try {
			await this.storage.put(ROOM_STATE_KEY, this.buildRoomState());
		} catch (error) {
			console.error('Failed to persist room state:', error);
		}
	}

	// Resets every persisted lifecycle field back to a fresh room. With
	// `durable` it also removes any roomState that was already written, so a
	// partially initialized init can never be resurrected by hydrate().
	async resetRoomState({ durable = false } = {}) {
		this.match = null;
		this.phase = PHASE.WAITING_FOR_PLAYERS;
		this.waitDeadline = null;
		this.lastResults = null;
		this.rematchState = { offerId: null, requesterId: null, expiresAt: null };
		this.clearAlarmState();
		this.rematchOffers.clear();
		this.playerToRematchOffer.clear();
		this.activeGames.clear();
		this.playerToGame.clear();

		if (durable && this.storage?.delete) {
			try {
				await this.storage.delete(ROOM_STATE_KEY);
			} catch (error) {
				console.error('Failed to roll back persisted room state:', error);
			}
		}
	}

	async hydrate() {
		if (this.hydrated) return;
		this.hydrated = true;
		if (!this.storage?.get) return;

		let saved = null;
		try {
			saved = await this.storage.get(ROOM_STATE_KEY);
		} catch (error) {
			console.error('Failed to load room state:', error);
			return;
		}
		if (!saved) return;

		this.match = saved.match ?? null;
		this.phase = saved.phase ?? PHASE.WAITING_FOR_PLAYERS;
		this.waitDeadline = saved.waitDeadline ?? null;
		if (saved.alarm) {
			this.alarmPurpose = saved.alarm.purpose ?? null;
			this.alarmDeadline = saved.alarm.deadline ?? null;
		}
		this.lastResults = saved.results ?? null;

		if (saved.rematch?.offerId) {
			this.rematchState = saved.rematch;
			this.rebuildRematchOfferFromState(saved.rematch);
		}

		if (saved.round) {
			await this.restoreRound(saved.round);

			// Safety net: if a 'playing' round's deadline has passed and its
			// game_end alarm was already consumed (e.g. eviction mid-flight),
			// finalize it here so recovery can never stall in 'playing'.
			if (this.phase === PHASE.PLAYING) {
				const game = this.activeGames.get(saved.round.id);
				if (game?.endTime && game.endTime <= Date.now()) {
					await this.endGame(game.id, 'timeout');
				}
			}
		}

		// Process expired persisted alarms whose deadline was missed (e.g. the
		// alarm was lost before firing). Without this, a restart could leave the
		// room stuck forever in waiting_for_players or holding a stale rematch
		// offer. The handlers are idempotent: they no-op if the room was
		// already finalized, and the stale alarm state is cleared regardless so
		// a later restart never re-processes it. game_end recovery stays on the
		// stale-playing path above.
		if (this.alarmPurpose && this.alarmDeadline && this.alarmDeadline <= Date.now()) {
			if (this.alarmPurpose === 'wait') {
				await this.abortWaitingMatch();
			} else if (this.alarmPurpose === 'rematch_response') {
				this.expireRematchOffer();
			}
			this.clearAlarmState();
		}

		// Self-healing: if a pending alarm was lost (e.g. a crash between the
		// durable snapshot write and setAlarm), re-arm it from persisted state
		// so a restart can never strand the room in a waiting phase forever.
		if (
			this.alarmPurpose &&
			this.alarmDeadline &&
			this.alarmDeadline > Date.now() &&
			this.storage?.getAlarm &&
			this.storage?.setAlarm
		) {
			try {
				const current = await this.storage.getAlarm();
				if (current == null) {
					await this.storage.setAlarm(this.alarmDeadline);
				}
			} catch (error) {
				console.error('Failed to reconcile pending alarm:', error);
			}
		}
	}

	rebuildRematchOfferFromState(rematch) {
		if (!this.match) return;

		const offer = {
			id: rematch.offerId,
			modeSeconds: this.match.modeSeconds || DEFAULT_MODE_SECONDS,
			player1: { id: this.match.player1.id, userInfo: this.match.player1.userInfo },
			player2: { id: this.match.player2.id, userInfo: this.match.player2.userInfo },
			requesterId: rematch.requesterId,
		};

		this.rematchOffers.set(offer.id, offer);
		this.playerToRematchOffer.set(offer.player1.id, offer.id);
		this.playerToRematchOffer.set(offer.player2.id, offer.id);
	}

	async restoreRound(savedRound) {
		const game = {
			...savedRound,
			gameTimer: null,
			countdownTimer: null,
		};

		this.activeGames.set(game.id, game);
		this.playerToGame.set(game.player1.id, game.id);
		this.playerToGame.set(game.player2.id, game.id);

		if (this.phase === PHASE.COUNTDOWN) {
			await this.startCountdown(game.id);
		}
	}

	// ----- Alarm handling ----------------------------------------------------

	clearAlarmState() {
		this.alarmPurpose = null;
		this.alarmDeadline = null;
	}

	async clearAlarm() {
		this.clearAlarmState();
		if (this.storage?.deleteAlarm) {
			try {
				await this.storage.deleteAlarm();
			} catch (error) {
				console.error('Failed to clear alarm:', error);
			}
		}
	}

	async armWaitAlarm() {
		this.alarmPurpose = 'wait';
		this.alarmDeadline = Date.now() + MATCH_WAIT_TIMEOUT_MS;
		this.waitDeadline = this.alarmDeadline;
		await this.persistRoomState();
		if (this.storage?.setAlarm) {
			await this.storage.setAlarm(this.alarmDeadline);
		}
	}

	async armGameEndAlarm(durationMs) {
		this.alarmPurpose = 'game_end';
		this.alarmDeadline = Date.now() + durationMs;
		await this.persistRoomState();
		if (this.storage?.setAlarm) {
			await this.storage.setAlarm(this.alarmDeadline);
		}
	}

	async armRematchAlarm(expiresAt) {
		this.alarmPurpose = 'rematch_response';
		this.alarmDeadline = expiresAt;
		await this.persistRoomState();
		if (this.storage?.setAlarm) {
			await this.storage.setAlarm(this.alarmDeadline);
		}
	}

	// Single alarm at a time: purpose is persisted so the handler knows what
	// fired even after a restart. Alarms are durable, so a pending timeout
	// survives DO eviction and fires here on wake.
	async alarm() {
		await this.hydrate();
		const purpose = this.alarmPurpose;
		this.clearAlarmState();

		if (purpose === 'wait') {
			await this.abortWaitingMatch();
		} else if (purpose === 'game_end') {
			const gameId = this.activeGames.size === 1 ? this.activeGames.keys().next().value : null;
			if (gameId) {
				await this.endGame(gameId, 'timeout');
			}
		} else if (purpose === 'rematch_response') {
			this.expireRematchOffer();
		}
	}

	// ----- Fetch / init handshake -------------------------------------------

	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === '/init') {
			return this.handleInit(request);
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.handleSession(server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async handleInit(request) {
		try {
			await this.hydrate();

			if (this.activeGames.size > 0 || (this.match && this.phase !== PHASE.WAITING_FOR_PLAYERS)) {
				return this.jsonResponse({ error: 'Room already has an active match' }, 409);
			}

			const payload = await request.json();
			const gameId = typeof payload?.gameId === 'string' ? payload.gameId : null;
			const player1 = payload?.player1;
			const player2 = payload?.player2;

			if (!gameId || !player1?.id || !player2?.id || player1.id === player2.id) {
				return this.jsonResponse({ error: 'Invalid match payload' }, 400);
			}

			// Authoritative profiles come from D1, never from the client. Unknown
			// users resolve to neutral defaults.
			const profiles = await resolveServerProfiles(this.env, [
				String(player1.id),
				String(player2.id),
			]);

			this.match = {
				gameId,
				modeSeconds: this.normalizeModeSeconds(payload?.modeSeconds),
				player1: {
					id: String(player1.id),
					userInfo: profiles[String(player1.id)],
				},
				player2: {
					id: String(player2.id),
					userInfo: profiles[String(player2.id)],
				},
				createdAt: Date.now(),
			};
			this.phase = PHASE.WAITING_FOR_PLAYERS;
			this.waitDeadline = Date.now() + MATCH_WAIT_TIMEOUT_MS;
			this.lastResults = null;
			this.rematchState = { offerId: null, requesterId: null, expiresAt: null };
			// The wait alarm is part of the first durable snapshot so a crash
			// between the snapshot write and setAlarm is self-healed by hydrate.
			this.alarmPurpose = 'wait';
			this.alarmDeadline = this.waitDeadline;

			// The room is only considered initialized if the seed is durable.
			try {
				if (this.storage?.put) {
					await this.storage.put(ROOM_STATE_KEY, this.buildRoomState());
				}
			} catch (error) {
				console.error('Failed to persist match seed:', error);
				await this.resetRoomState();
				return this.jsonResponse({ error: 'Failed to persist match' }, 500);
			}

			try {
				if (this.storage?.setAlarm) {
					await this.storage.setAlarm(this.waitDeadline);
				}
			} catch (error) {
				console.error('Failed to arm wait alarm:', error);
				// The roomState snapshot was already written; roll it back so a
				// later hydrate() cannot resurrect this failed init.
				await this.resetRoomState({ durable: true });
				return this.jsonResponse({ error: 'Failed to arm wait alarm' }, 500);
			}

			return this.jsonResponse({ ok: true });
		} catch (error) {
			console.error('GameRoom init failed:', error);
			return this.jsonResponse({ error: 'Bad init request' }, 400);
		}
	}

	async abortWaitingMatch() {
		if (this.phase !== PHASE.WAITING_FOR_PLAYERS) return;
		if (this.activeGames.size > 0) return;

		this.phase = PHASE.ABORTED;
		this.waitDeadline = null;
		this.clearAlarmState();

		for (const sessionId of this.playerToSession.values()) {
			this.sendToPlayer(sessionId, { type: 'MATCH_ABORTED' });
		}

		for (const [sessionId] of this.sessions.entries()) {
			this.closeSession(sessionId, 4000, 'Match aborted');
		}

		await this.persistRoomState();
	}

	// ----- WebSocket session handling ---------------------------------------

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

	// ----- Rematch -----------------------------------------------------------

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

		this.rematchOffers.delete(offerId);
		this.playerToRematchOffer.delete(offer.player1.id);
		this.playerToRematchOffer.delete(offer.player2.id);

		if (this.rematchState.offerId === offerId) {
			this.rematchState = { offerId: null, requesterId: null, expiresAt: null };
			this.clearAlarm();
		}

		if (offer.requesterId) {
			this.sendToPlayer(this.playerToSession.get(offer.requesterId), {
				type: reason === 'declined' ? 'REMATCH_DECLINED' : reason === 'timeout' ? 'REMATCH_TIMEOUT' : 'REMATCH_UNAVAILABLE',
			});
		}

		this.persistRoomState();
	}

	expireRematchOffer() {
		if (!this.rematchState.offerId) return;
		this.clearRematchOffer(this.rematchState.offerId, 'timeout');
	}

	createRematchOfferFromGame(game) {
		const offerId = createId('rematch');
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
		};

		this.rematchOffers.set(offerId, offer);
		this.playerToRematchOffer.set(game.player1.id, offerId);
		this.playerToRematchOffer.set(game.player2.id, offerId);

		this.rematchState = { offerId, requesterId: null, expiresAt: null };
	}

	async handleRematchRequest(playerId) {
		const offerId = this.playerToRematchOffer.get(playerId);
		if (!offerId) return;

		const offer = this.rematchOffers.get(offerId);
		if (!offer || offer.requesterId) return;

		const isPlayer1 = offer.player1.id === playerId;
		const requester = isPlayer1 ? offer.player1 : offer.player2;
		const responder = isPlayer1 ? offer.player2 : offer.player1;

		offer.requesterId = requester.id;
		this.rematchState.requesterId = requester.id;
		this.rematchState.expiresAt = Date.now() + REMATCH_RESPONSE_WINDOW_MS;

		// Arm the expiry alarm before notifying anyone. If it cannot be armed,
		// fail the request deterministically instead of leaving it pending
		// forever.
		try {
			await this.armRematchAlarm(this.rematchState.expiresAt);
		} catch (error) {
			console.error('Failed to arm rematch alarm; cancelling rematch request:', error);
			this.clearRematchOffer(offerId, 'timeout');
			return;
		}

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
	}

	async handleRematchResponse(playerId, action) {
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

		this.rematchOffers.delete(offerId);
		this.playerToRematchOffer.delete(offer.player1.id);
		this.playerToRematchOffer.delete(offer.player2.id);
		this.rematchState = { offerId: null, requesterId: null, expiresAt: null };
		this.clearAlarm();

		await this.createGame();
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
				avatarId: opponent.userInfo.avatarId,
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
					case 'JOIN_GAME':
						try {
							playerId = await this.handleJoinGame(message, webSocket, sessionId);
						} catch (error) {
							console.error('JOIN_GAME failed:', error);
							try {
								webSocket.send(JSON.stringify({ type: 'ERROR', error: 'UNAUTHORIZED' }));
							} catch {
								// ignore
							}
							webSocket.close(1008, 'Unauthorized');
						}
						break;

					case 'PLAYER_INPUT':
						if (playerId) {
							this.handlePlayerInput(playerId, message.input);
						}
						break;

					case 'REMATCH_REQUEST':
						if (playerId) {
							await this.handleRematchRequest(playerId);
						}
						break;

					case 'REMATCH_RESPONSE':
						if (playerId) {
							await this.handleRematchResponse(playerId, message.action);
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

	async handleJoinGame(message, webSocket, sessionId) {
		const playerId = await this.authenticateAndGetPlayerId(message);

		await this.hydrate();

		if (!this.match) {
			throw new Error('No match for this room');
		}
		if (this.phase === PHASE.ABORTED) {
			throw new Error('Match aborted');
		}

		const isPlayer1 = this.match.player1.id === playerId;
		const isPlayer2 = this.match.player2.id === playerId;
		if (!isPlayer1 && !isPlayer2) {
			throw new Error('Not part of this match');
		}

		const previousSessionId = this.playerToSession.get(playerId);
		if (
			previousSessionId &&
			previousSessionId !== sessionId &&
			this.getSessionOrder(previousSessionId) > this.getSessionOrder(sessionId)
		) {
			this.closeSession(sessionId, 1000, 'Superseded by newer session');
			return playerId;
		}

		if (previousSessionId && previousSessionId !== sessionId) {
			this.closeSession(previousSessionId, 1000, 'Replaced by newer session');
		}

		this.playerToSession.set(playerId, sessionId);
		this.connectedPlayers.add(playerId);

		if (this.rebindPlayerToCurrentGame(playerId, sessionId)) {
			return playerId;
		}

		// A new round is ONLY started from the handoff phase. This is what keeps
		// a recovered room (e.g. resumed into 'finished' or 'playing') from ever
		// silently spawning a fresh round just because both players reconnected.
		const bothReady =
			this.connectedPlayers.has(this.match.player1.id) &&
			this.connectedPlayers.has(this.match.player2.id);

		if (bothReady && this.activeGames.size === 0 && this.phase === PHASE.WAITING_FOR_PLAYERS) {
			await this.createGame();
		}

		return playerId;
	}

	generateSessionId() {
		return createId('session');
	}

	async createGame() {
		const match = this.match;
		if (!match) return;

		if (this.phase === PHASE.ABORTED || this.activeGames.size > 0) {
			return;
		}

		await this.clearAlarm();

		this.clearPlayerRematchOffer(match.player1.id);
		this.clearPlayerRematchOffer(match.player2.id);

		const session1 = this.playerToSession.get(match.player1.id);
		const session2 = this.playerToSession.get(match.player2.id);
		if (!session1 || !session2) return;

		const gameId = createId('game');
		const wordSeed = generateSeed();
		const difficulty = WORD_DIFFICULTIES.medium;
		const normalizedModeSeconds = this.normalizeModeSeconds(match.modeSeconds);
		const words = generateWords(
			wordSeed,
			difficulty,
			Math.max(18, Math.round(normalizedModeSeconds * 0.75))
		);

		const game = {
			id: gameId,
			difficulty,
			seed: wordSeed,
			modeSeconds: normalizedModeSeconds,
			player1: {
				id: match.player1.id,
				sessionId: session1,
				userInfo: match.player1.userInfo,
				score: 0,
				currentWordIndex: 0,
			},
			player2: {
				id: match.player2.id,
				sessionId: session2,
				userInfo: match.player2.userInfo,
				score: 0,
				currentWordIndex: 0,
			},
			words,
			status: 'countdown',
			startTime: null,
			endTime: null,
			countdownStart: null,
			countdownTimer: null,
			gameTimer: null,
		};

		this.phase = PHASE.COUNTDOWN;
		this.waitDeadline = null;
		this.activeGames.set(gameId, game);
		this.playerToGame.set(match.player1.id, gameId);
		this.playerToGame.set(match.player2.id, gameId);

		this.sendToPlayer(session1, {
			type: 'MATCH_FOUND',
			gameId,
			modeSeconds: normalizedModeSeconds,
			opponent: {
				id: match.player2.id,
				username: match.player2.userInfo.username,
				rating: match.player2.userInfo.rating,
				avatarId: match.player2.userInfo.avatarId,
			},
		});

		this.sendToPlayer(session2, {
			type: 'MATCH_FOUND',
			gameId,
			modeSeconds: normalizedModeSeconds,
			opponent: {
				id: match.player1.id,
				username: match.player1.userInfo.username,
				rating: match.player1.userInfo.rating,
				avatarId: match.player1.userInfo.avatarId,
			},
		});

		this.persistRoomState();
		await this.startCountdown(gameId);
	}

	async startCountdown(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game || game.status !== 'countdown' || game.countdownTimer) return;

		if (!game.countdownStart) {
			game.countdownStart = Date.now();
			await this.persistRoomState();
		}

		const remainingTotal = COUNTDOWN_TOTAL_MS - (Date.now() - game.countdownStart);
		if (remainingTotal <= 0) {
			this.startGame(gameId).catch((error) => console.error('Failed to start game:', error));
			return;
		}

		const count = Math.min(3, Math.max(0, Math.ceil((remainingTotal - GO_DELAY_MS) / 1000)));

		this.sendToPlayers(game, {
			type: 'COUNTDOWN',
			count: count,
		});

		game.countdownTimer = setTimeout(() => {
			game.countdownTimer = null;
			if (count === 0) {
				this.startGame(gameId).catch((error) => console.error('Failed to start game:', error));
				return;
			}
			this.startCountdown(gameId).catch((error) =>
				console.error('Failed to continue countdown:', error)
			);
		}, count === 0 ? GO_DELAY_MS : 1000);
	}

	async startGame(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game || game.status !== 'countdown') return;

		const durationMs = (game.modeSeconds || DEFAULT_MODE_SECONDS) * 1000;

		game.status = 'playing';
		game.startTime = Date.now();
		game.endTime = game.startTime + durationMs;
		game.countdownTimer = null;

		this.sendToPlayers(game, {
			type: 'GAME_START',
			words: game.words,
			difficulty: game.difficulty,
			modeSeconds: game.modeSeconds,
			duration: durationMs,
			startTime: game.startTime,
		});

		this.phase = PHASE.PLAYING;
		await this.persistRoomState();

		// The round must never hang forever just because its end alarm could
		// not be armed: fail closed by ending it as a timeout instead.
		try {
			await this.armGameEndAlarm(durationMs);
		} catch (error) {
			console.error('Failed to arm game end alarm; ending game as timeout:', error);
			await this.endGame(gameId, 'timeout');
		}
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
			this.endGame(gameId, 'completed').catch((error) =>
				console.error('Failed to finalize game:', error)
			);
			return;
		}

		if (normalizedInput === currentWord.toLowerCase()) {
			player.score++;
			player.currentWordIndex++;

			this.sendToPlayers(game, {
				type: 'PLAYER_PROGRESS',
				...this.buildProgressPayload(game),
			});

			// Throttled persistence keeps recovery roughly in sync without
			// writing to storage on every keystroke.
			const now = Date.now();
			if (now - this.lastProgressPersistAt >= PROGRESS_PERSIST_INTERVAL_MS) {
				this.lastProgressPersistAt = now;
				this.persistRoomState();
			}

			if (player.currentWordIndex >= game.words.length) {
				this.endGame(gameId, 'completed').catch((error) =>
					console.error('Failed to finalize game:', error)
				);
			}
		} else {
			this.sendToPlayer(this.playerToSession.get(playerId), {
				type: 'WRONG_WORD',
			});
		}
	}

	async endGame(gameId, reason = 'timeout', options = {}) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		if (game.gameTimer) {
			clearTimeout(game.gameTimer);
		}
		if (game.countdownTimer) {
			clearTimeout(game.countdownTimer);
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

		const results = {
			gameId,
			modeSeconds: game.modeSeconds || DEFAULT_MODE_SECONDS,
			player1: {
				id: game.player1.id,
				username: game.player1.userInfo.username,
				avatarId: game.player1.userInfo.avatarId,
				score: game.player1.score,
				progress: game.player1.currentWordIndex,
				won: player1Won,
			},
			player2: {
				id: game.player2.id,
				username: game.player2.userInfo.username,
				avatarId: game.player2.userInfo.avatarId,
				score: game.player2.score,
				progress: game.player2.currentWordIndex,
				won: player2Won,
			},
			isDraw,
			reason,
		};

		if (this.env?.DB) {
			try {
				const persisted = await persistRankedMatchResult(drizzle(this.env.DB), {
					gameId,
					modeSeconds: results.modeSeconds,
					roomCode: null,
					difficulty: game.difficulty,
					seed: game.seed,
					startedAt: game.startTime ? new Date(game.startTime) : null,
					endedAt: new Date(),
					player1: results.player1,
					player2: results.player2,
					isDraw,
					disconnectedPlayerId:
						reason === 'opponent_disconnected' ? options?.disconnectedPlayerId ?? null : null,
				});
				if (persisted?.ratings) {
					results.ratings = persisted.ratings;
				}
			} catch (error) {
				console.error('Failed to persist ranked match result:', error);
			}
		}

		this.sendToPlayers(game, {
			type: 'GAME_END',
			results,
		});

		this.lastResults = results;
		this.playerToGame.delete(game.player1.id);
		this.playerToGame.delete(game.player2.id);
		this.activeGames.delete(gameId);

		this.phase = PHASE.FINISHED;
		this.clearAlarmState();

		if (reason !== 'opponent_disconnected') {
			this.createRematchOfferFromGame(game);
		} else {
			this.rematchState = { offerId: null, requesterId: null, expiresAt: null };
		}

		await this.persistRoomState();
	}

	handlePlayerDisconnect(playerId) {
		this.clearPlayerRematchOffer(playerId);
		this.connectedPlayers.delete(playerId);

		const gameId = this.playerToGame.get(playerId);
		if (gameId) {
			const game = this.activeGames.get(gameId);
			if (game) {
				this.endGame(gameId, 'opponent_disconnected', {
					disconnectedPlayerId: playerId,
				}).catch((error) => console.error('Failed to finalize game:', error));
				return;
			}

			this.playerToGame.delete(playerId);
		}

		// No active round: we deliberately do NOT abort immediately during the
		// handoff window. The single disconnect may be a transient reconnect;
		// the wait alarm aborts the room at the deadline instead.
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
