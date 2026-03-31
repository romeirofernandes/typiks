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
