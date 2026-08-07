import { describe, expect, it } from 'vitest';
import { GameRoom } from '../src/durable-objects/GameRoom.js';

function createSocket() {
	const sent = [];
	const openState = Number.isFinite(WebSocket.OPEN) ? WebSocket.OPEN : 1;
	const closedState = Number.isFinite(WebSocket.CLOSED) ? WebSocket.CLOSED : 3;

	return {
		readyState: openState,
		send(payload) {
			sent.push(payload);
		},
		close() {
			this.readyState = closedState;
		},
		get sentMessages() {
			return sent.map((value) => JSON.parse(value));
		},
	};
}

function createRoom() {
	return new GameRoom({}, { FIREBASE_PROJECT_ID: 'typiks' });
}

function createGame() {
	return {
		id: 'game-1',
		difficulty: 'medium',
		player1: {
			id: 'p1',
			sessionId: 'session-p1',
			userInfo: { username: 'alice', rating: 1000 },
			score: 3,
			currentWordIndex: 3,
		},
		player2: {
			id: 'p2',
			sessionId: 'session-p2',
			userInfo: { username: 'bob', rating: 1000 },
			score: 2,
			currentWordIndex: 2,
		},
		words: ['alpha', 'bravo', 'charlie'],
		status: 'playing',
		startTime: Date.now(),
		endTime: Date.now() + 60_000,
		gameTimer: null,
	};
}

describe('GameRoom websocket session handling', () => {
	it('ignores stale session termination for a player with a newer session', () => {
		const room = createRoom();
		const game = createGame();
		const gameId = game.id;

		room.activeGames.set(gameId, game);
		room.playerToGame.set('p1', gameId);
		room.playerToGame.set('p2', gameId);
		room.playerToSession.set('p1', 'session-p1-new');
		room.sessions.set('session-p1-old', createSocket());

		room.handleSessionTermination('session-p1-old', 'p1');

		expect(room.activeGames.has(gameId)).toBe(true);
		expect(room.playerToGame.get('p1')).toBe(gameId);
		expect(room.playerToSession.get('p1')).toBe('session-p1-new');
	});

	it('ends game and awards win to connected opponent on disconnect', () => {
		const room = createRoom();
		const game = createGame();
		const gameId = game.id;
		const opponentSocket = createSocket();

		room.activeGames.set(gameId, game);
		room.playerToGame.set('p1', gameId);
		room.playerToGame.set('p2', gameId);
		room.playerToSession.set('p1', 'session-p1');
		room.playerToSession.set('p2', 'session-p2');
		room.sessions.set('session-p1', createSocket());
		room.sessions.set('session-p2', opponentSocket);

		room.handleSessionTermination('session-p1', 'p1');

		expect(room.activeGames.has(gameId)).toBe(false);
		expect(room.playerToGame.has('p1')).toBe(false);
		expect(room.playerToGame.has('p2')).toBe(false);
		expect(room.playerToSession.has('p1')).toBe(false);
		expect(opponentSocket.sentMessages).toHaveLength(1);
		expect(opponentSocket.sentMessages[0]).toMatchObject({
			type: 'GAME_END',
			results: {
				reason: 'opponent_disconnected',
				isDraw: false,
				player1: { id: 'p1', won: false },
				player2: { id: 'p2', won: true },
			},
		});
	});

	it('rebinds reconnecting players to the active game session', () => {
		const room = createRoom();
		const game = createGame();
		const gameId = game.id;
		const resumedSocket = createSocket();

		room.activeGames.set(gameId, game);
		room.playerToGame.set('p1', gameId);
		room.playerToSession.set('p1', 'session-p1-reconnected');
		room.sessions.set('session-p1-reconnected', resumedSocket);

		const didRebind = room.rebindPlayerToCurrentGame('p1', 'session-p1-reconnected');

		expect(didRebind).toBe(true);
		expect(game.player1.sessionId).toBe('session-p1-reconnected');
		expect(resumedSocket.sentMessages[0]).toMatchObject({
			type: 'GAME_RESUMED',
			gameId,
			status: 'playing',
			player1: { id: 'p1', currentWordIndex: 3, score: 3 },
			player2: { id: 'p2', currentWordIndex: 2, score: 2 },
		});
	});
});

function createStoredState(overrides = {}) {
	return {
		match: {
			gameId: 'game-1',
			modeSeconds: 60,
			player1: { id: 'p1', userInfo: { username: 'alice', rating: 800, avatarId: 'avatar1' } },
			player2: { id: 'p2', userInfo: { username: 'bob', rating: 800, avatarId: 'avatar1' } },
			createdAt: Date.now(),
		},
		phase: 'waiting_for_players',
		waitDeadline: null,
		alarm: null,
		round: null,
		results: null,
		rematch: { offerId: null, requesterId: null, expiresAt: null },
		...overrides,
	};
}

function createStoredStorage(state) {
	const data = new Map([['roomState', state]]);
	return {
		async get(key) {
			return data.get(key);
		},
		async put(key, value) {
			data.set(key, value);
		},
	};
}

describe('GameRoom init handshake', () => {
	it('accepts a valid /init and arms the wait alarm with server-trusted profiles', async () => {
		const room = createRoom();
		const request = new Request('http://typiks/init', {
			method: 'POST',
			body: JSON.stringify({
				gameId: 'game-abc',
				modeSeconds: 60,
				// Client-asserted values must be ignored when no DB profile exists.
				player1: { id: 'p1', userInfo: { username: 'hacker', rating: 9999, avatarId: 'avatar9' } },
				player2: { id: 'p2', userInfo: { username: 'spoof', rating: 1, avatarId: 'avatar2' } },
			}),
		});

		const response = await room.handleInit(request);

		expect(response.status).toBe(200);
		expect((await response.json()).ok).toBe(true);
		expect(room.phase).toBe('waiting_for_players');
		expect(room.alarmPurpose).toBe('wait');
		expect(room.waitDeadline).toBeGreaterThan(Date.now());
		expect(room.match.player1.userInfo).toEqual({ username: 'player', rating: 800, avatarId: 'avatar1' });
		expect(room.match.player2.userInfo).toEqual({ username: 'player', rating: 800, avatarId: 'avatar1' });
	});

	it('rejects an invalid /init payload', async () => {
		const room = createRoom();
		const request = new Request('http://typiks/init', {
			method: 'POST',
			body: JSON.stringify({ gameId: 'game-1', player1: { id: 'p1' } }),
		});

		const response = await room.handleInit(request);

		expect(response.status).toBe(400);
		expect(room.match).toBeNull();
	});

	it('returns 500 when the match seed cannot be persisted durably', async () => {
		const room = new GameRoom(
			{
				storage: {
					async put() {
						throw new Error('disk full');
					},
				},
			},
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);
		const request = new Request('http://typiks/init', {
			method: 'POST',
			body: JSON.stringify({
				gameId: 'game-1',
				modeSeconds: 60,
				player1: { id: 'p1' },
				player2: { id: 'p2' },
			}),
		});

		const response = await room.handleInit(request);

		expect(response.status).toBe(500);
		expect(room.match).toBeNull();
	});
});

describe('GameRoom handoff timeout', () => {
	function connectedWaitingRoom() {
		const room = createRoom();
		const p2Socket = createSocket();
		room.match = {
			gameId: 'game-1',
			modeSeconds: 60,
			player1: { id: 'p1', userInfo: { username: 'alice', rating: 800, avatarId: 'avatar1' } },
			player2: { id: 'p2', userInfo: { username: 'bob', rating: 800, avatarId: 'avatar1' } },
			createdAt: Date.now(),
		};
		room.phase = 'waiting_for_players';
		room.playerToSession.set('p1', 'session-p1');
		room.playerToSession.set('p2', 'session-p2');
		room.sessions.set('session-p1', createSocket());
		room.sessions.set('session-p2', p2Socket);
		room.connectedPlayers.add('p1');
		room.connectedPlayers.add('p2');
		return { room, p2Socket };
	}

	it('does not abort during the handoff window on a single disconnect', () => {
		const { room, p2Socket } = connectedWaitingRoom();

		room.handleSessionTermination('session-p1', 'p1');

		expect(room.phase).toBe('waiting_for_players');
		expect(room.playerToSession.has('p1')).toBe(false);
		expect(p2Socket.sentMessages).toHaveLength(0);

		// Only the wait alarm aborts the room.
		room.abortWaitingMatch();
		expect(room.phase).toBe('aborted');
		expect(p2Socket.sentMessages[0]).toMatchObject({ type: 'MATCH_ABORTED' });
	});

	it('aborts via the wait alarm after the handoff deadline', async () => {
		const { room, p2Socket } = connectedWaitingRoom();

		await room.armWaitAlarm();
		expect(room.alarmPurpose).toBe('wait');

		await room.alarm();

		expect(room.phase).toBe('aborted');
		expect(p2Socket.sentMessages[0]).toMatchObject({ type: 'MATCH_ABORTED' });
	});

	it('lets both players join and start the round, cancelling the wait alarm', async () => {
		const { room } = connectedWaitingRoom();

		await room.armWaitAlarm();
		room.playerToSession.set('p1', 'session-p1');
		room.playerToSession.set('p2', 'session-p2');
		room.connectedPlayers.add('p1');
		room.connectedPlayers.add('p2');

		await room.createGame();

		expect(room.phase).toBe('countdown');
		expect(room.alarmPurpose).toBeNull();
		expect(room.activeGames.size).toBe(1);
	});
});

describe('GameRoom recovery', () => {
	it('does not mint a fresh round when recovered with an active round', async () => {
		const state = createStoredState({
			phase: 'playing',
			round: {
				id: 'round-1',
				difficulty: 'medium',
				modeSeconds: 60,
				status: 'playing',
				startTime: Date.now() - 5000,
				endTime: Date.now() + 25000,
				countdownStart: null,
				words: ['alpha', 'bravo'],
				player1: { id: 'p1', sessionId: 'session-p1', userInfo: { username: 'alice', rating: 800, avatarId: 'avatar1' }, score: 5, currentWordIndex: 5 },
				player2: { id: 'p2', sessionId: 'session-p2', userInfo: { username: 'bob', rating: 800, avatarId: 'avatar1' }, score: 3, currentWordIndex: 3 },
			},
		});
		const room = new GameRoom(
			{ storage: createStoredStorage(state) },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);

		await room.hydrate();

		expect(room.phase).toBe('playing');
		expect(room.activeGames.size).toBe(1);
		expect(room.playerToGame.get('p1')).toBe('round-1');

		// Both players being present after recovery must not spawn a new round
		// on top of the recovered one.
		room.connectedPlayers.add('p1');
		room.connectedPlayers.add('p2');
		await room.createGame();

		expect(room.activeGames.size).toBe(1);
		expect([...room.activeGames.keys()][0]).toBe('round-1');
	});

	it('does not start a fresh round when a player reconnects into a finished recovered room', async () => {
		const state = createStoredState({
			phase: 'finished',
			results: {
				gameId: 'round-1',
				modeSeconds: 60,
				player1: { id: 'p1', username: 'alice', avatarId: 'avatar1', score: 5, progress: 5, won: true },
				player2: { id: 'p2', username: 'bob', avatarId: 'avatar1', score: 3, progress: 3, won: false },
				isDraw: false,
				reason: 'timeout',
			},
		});
		const room = new GameRoom(
			{ storage: createStoredStorage(state) },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);
		// Stub auth so the reconnect path is reachable in a unit test.
		room.authenticateAndGetPlayerId = async () => 'p1';

		const p1Socket = createSocket();
		const sessionId = room.generateSessionId();
		room.sessions.set(sessionId, p1Socket);
		room.sessionOrder.set(sessionId, room.nextSessionOrder++);
		room.playerToSession.set('p2', 'session-p2');
		room.sessions.set('session-p2', createSocket());
		room.connectedPlayers.add('p2');

		await room.handleJoinGame({ idToken: 'token' }, p1Socket, sessionId);

		expect(room.connectedPlayers.has('p1')).toBe(true);
		expect(room.activeGames.size).toBe(0);
		expect(p1Socket.sentMessages).toHaveLength(0);
	});
});

describe('GameRoom expired persisted alarms', () => {
	it('aborts a waiting match when a persisted wait alarm deadline has passed', async () => {
		const state = createStoredState({
			phase: 'waiting_for_players',
			waitDeadline: Date.now() - 1000,
			alarm: { purpose: 'wait', deadline: Date.now() - 1000 },
		});
		const room = new GameRoom(
			{ storage: createStoredStorage(state) },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);

		await room.hydrate();

		expect(room.phase).toBe('aborted');
		expect(room.alarmPurpose).toBeNull();
	});

	it('expires a stale rematch offer when a persisted rematch alarm deadline has passed', async () => {
		const state = createStoredState({
			phase: 'finished',
			results: {
				gameId: 'round-1',
				modeSeconds: 60,
				player1: { id: 'p1', username: 'alice', avatarId: 'avatar1', score: 5, progress: 5, won: true },
				player2: { id: 'p2', username: 'bob', avatarId: 'avatar1', score: 3, progress: 3, won: false },
				isDraw: false,
				reason: 'timeout',
			},
			rematch: { offerId: 'rematch-1', requesterId: 'p1', expiresAt: Date.now() - 1000 },
			alarm: { purpose: 'rematch_response', deadline: Date.now() - 1000 },
		});
		const room = new GameRoom(
			{ storage: createStoredStorage(state) },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);

		await room.hydrate();

		expect(room.rematchState.offerId).toBeNull();
		expect(room.rematchOffers.size).toBe(0);
	});

	it('is idempotent when the room was already finalized', async () => {
		const state = createStoredState({
			phase: 'aborted',
			waitDeadline: Date.now() - 1000,
			alarm: { purpose: 'wait', deadline: Date.now() - 1000 },
		});
		const room = new GameRoom(
			{ storage: createStoredStorage(state) },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);

		await room.hydrate();

		expect(room.phase).toBe('aborted');
		expect(room.alarmPurpose).toBeNull();
	});
});

describe('GameRoom init rollback on alarm failure', () => {
	it('leaves no durable room state behind when the wait alarm cannot be armed', async () => {
		const data = new Map();
		const storage = {
			async get(key) {
				return data.get(key);
			},
			async put(key, value) {
				data.set(key, value);
			},
			async delete(key) {
				data.delete(key);
			},
			async setAlarm() {
				throw new Error('alarm backend down');
			},
		};
		const room = new GameRoom({ storage }, { FIREBASE_PROJECT_ID: 'typiks' });
		const request = new Request('http://typiks/init', {
			method: 'POST',
			body: JSON.stringify({
				gameId: 'game-1',
				modeSeconds: 60,
				player1: { id: 'p1' },
				player2: { id: 'p2' },
			}),
		});

		const response = await room.handleInit(request);

		expect(response.status).toBe(500);
		expect(data.has('roomState')).toBe(false);
		expect(room.match).toBeNull();
		expect(room.alarmPurpose).toBeNull();
	});
});

describe('GameRoom alarm setup failure fallbacks', () => {
	function storageWithFailingAlarm() {
		return {
			async get() {
				return undefined;
			},
			async put() {},
			async setAlarm() {
				throw new Error('alarm backend down');
			},
		};
	}

	it('ends the round as timeout when the game_end alarm cannot be armed', async () => {
		const room = new GameRoom(
			{ storage: storageWithFailingAlarm() },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);
		const game = { ...createGame(), status: 'countdown', startTime: null, endTime: null, countdownTimer: null };
		const gameId = game.id;
		const p1Socket = createSocket();
		const p2Socket = createSocket();

		room.activeGames.set(gameId, game);
		room.playerToGame.set('p1', gameId);
		room.playerToGame.set('p2', gameId);
		room.playerToSession.set('p1', 'session-p1');
		room.playerToSession.set('p2', 'session-p2');
		room.sessions.set('session-p1', p1Socket);
		room.sessions.set('session-p2', p2Socket);
		room.phase = 'countdown';

		await room.startGame(gameId);

		expect(room.phase).toBe('finished');
		expect(room.activeGames.size).toBe(0);
		expect(p1Socket.sentMessages.at(-1)).toMatchObject({ type: 'GAME_END' });
		expect(p2Socket.sentMessages.at(-1)).toMatchObject({ type: 'GAME_END' });
	});

	it('clears a rematch request instead of leaving it pending when the rematch alarm cannot be armed', async () => {
		const room = new GameRoom(
			{ storage: storageWithFailingAlarm() },
			{ FIREBASE_PROJECT_ID: 'typiks' }
		);
		room.phase = 'finished';
		room.createRematchOfferFromGame({
			modeSeconds: 60,
			player1: { id: 'p1', userInfo: { username: 'alice', rating: 800, avatarId: 'avatar1' } },
			player2: { id: 'p2', userInfo: { username: 'bob', rating: 800, avatarId: 'avatar1' } },
		});

		const requesterSocket = createSocket();
		const responderSocket = createSocket();
		room.playerToSession.set('p1', 'session-p1');
		room.playerToSession.set('p2', 'session-p2');
		room.sessions.set('session-p1', requesterSocket);
		room.sessions.set('session-p2', responderSocket);

		await room.handleRematchRequest('p1');

		expect(room.rematchState.offerId).toBeNull();
		expect(room.rematchOffers.size).toBe(0);
		expect(requesterSocket.sentMessages.map((m) => m.type)).toContain('REMATCH_TIMEOUT');
		expect(responderSocket.sentMessages).toHaveLength(0);
	});
});
