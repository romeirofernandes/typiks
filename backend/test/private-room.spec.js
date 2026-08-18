import { describe, expect, it } from 'vitest';
import {
	normalizePrivateRoomSettings,
	PrivateRoom,
	PRIVATE_ROOM_LIMITS,
} from '../src/durable-objects/PrivateRoom.js';

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
	return new PrivateRoom({}, { FIREBASE_PROJECT_ID: 'typiks' });
}

function createFakeStorage() {
	const store = new Map();
	let alarm = null;
	return {
		async put(key, value) {
			store.set(key, value);
		},
		async get(key) {
			return store.get(key) ?? null;
		},
		async delete(key) {
			store.delete(key);
		},
		async setAlarm(timestamp) {
			alarm = timestamp;
		},
		async getAlarm() {
			return alarm;
		},
		async deleteAlarm() {
			alarm = null;
		},
		keys() {
			return Array.from(store.keys());
		},
		alarmValue() {
			return alarm;
		},
	};
}

function createRoomWithStorage(storage) {
	return new PrivateRoom({ storage }, { FIREBASE_PROJECT_ID: 'typiks' });
}

function addMember(room, id, { username = id, rating = 1100, ready = false, teamId = null } = {}) {
	room.members.set(id, {
		id,
		sessionId: `session-${id}`,
		userInfo: { username, rating },
		ready,
		teamId,
		joinedAt: Date.now(),
	});
}

function makePlayingGame(room, { endTimeInMs = 60000 } = {}) {
	room.gameState = 'playing';
	room.game = {
		id: 'game-1',
		seed: 'seed123',
		countdown: 0,
		countdownEndsAt: null,
		countdownInterval: null,
		startTimeout: null,
		gameTimer: null,
		words: ['alpha', 'bravo'],
		progress: new Map([
			['leader', { score: 2, correctChars: 10, currentWordIndex: 2 }],
			['p2', { score: 1, correctChars: 5, currentWordIndex: 1 }],
		]),
		teamProgress: new Map(),
		startTime: Date.now() - 10000,
		endTime: Date.now() + endTimeInMs,
	};
}

describe('PrivateRoom settings', () => {
	it('rejects invalid player limits', () => {
		const tooLow = normalizePrivateRoomSettings({ maxPlayers: 1 });
		const tooHigh = normalizePrivateRoomSettings({ maxPlayers: 99 });

		expect(tooLow.error).toContain(String(PRIVATE_ROOM_LIMITS.minPlayers));
		expect(tooHigh.error).toContain(String(PRIVATE_ROOM_LIMITS.maxPlayers));
	});

	it('rejects maxPlayers lower than current room size', () => {
		const result = normalizePrivateRoomSettings({ maxPlayers: 2 }, { currentMembers: 3 });
		expect(result.error).toContain('current room size');
	});
});

describe('PrivateRoom start guards', () => {
	it('allows only the owner to start and only when everyone is ready', () => {
		const room = createRoom();
		room.ownerId = 'leader';
		room.members.set('leader', {
			id: 'leader',
			sessionId: 's1',
			userInfo: { username: 'leader', rating: 1200 },
			ready: true,
			joinedAt: Date.now(),
		});
		room.members.set('player-2', {
			id: 'player-2',
			sessionId: 's2',
			userInfo: { username: 'player-2', rating: 1150 },
			ready: false,
			joinedAt: Date.now() + 1,
		});

		expect(room.canPlayerStartGame('leader')).toBe(false);
		expect(room.canPlayerStartGame('player-2')).toBe(false);

		room.members.get('player-2').ready = true;
		expect(room.canPlayerStartGame('player-2')).toBe(false);
		expect(room.canPlayerStartGame('leader')).toBe(true);
	});

	it('returns room errors for non-leader or not-all-ready start attempts', () => {
		const room = createRoom();
		const leaderSocket = createSocket();
		const otherSocket = createSocket();

		room.ownerId = 'leader';
		room.sessions.set('leader-session', leaderSocket);
		room.sessions.set('other-session', otherSocket);
		room.playerToSession.set('leader', 'leader-session');
		room.playerToSession.set('other', 'other-session');
		room.members.set('leader', {
			id: 'leader',
			sessionId: 'leader-session',
			userInfo: { username: 'leader', rating: 1200 },
			ready: true,
			joinedAt: Date.now(),
		});
		room.members.set('other', {
			id: 'other',
			sessionId: 'other-session',
			userInfo: { username: 'other', rating: 1100 },
			ready: false,
			joinedAt: Date.now() + 1,
		});

		room.handleStartRequest('other');
		expect(otherSocket.sentMessages[0]).toMatchObject({
			type: 'ROOM_ERROR',
			error: 'Only the room leader can start the game',
		});

		room.handleStartRequest('leader');
		expect(leaderSocket.sentMessages[0]).toMatchObject({
			type: 'ROOM_ERROR',
			error: 'All players must be ready before starting',
		});
	});

	it('requires coop players to join a team before setting ready', () => {
		const room = createRoom();
		const playerSocket = createSocket();

		room.settings.gameMode = 'coop';
		room.ownerId = 'leader';
		room.sessions.set('player-session', playerSocket);
		room.playerToSession.set('player-2', 'player-session');
		room.members.set('leader', {
			id: 'leader',
			sessionId: 'leader-session',
			userInfo: { username: 'leader', rating: 1200 },
			ready: true,
			teamId: 'team1',
			joinedAt: Date.now(),
		});
		room.members.set('player-2', {
			id: 'player-2',
			sessionId: 'player-session',
			userInfo: { username: 'player-2', rating: 1100 },
			ready: false,
			teamId: null,
			joinedAt: Date.now() + 1,
		});

		room.handleReady('player-2', true);

		expect(playerSocket.sentMessages[0]).toMatchObject({
			type: 'ROOM_ERROR',
			error: 'Join a valid team before setting ready',
		});
		expect(room.members.get('player-2').ready).toBe(false);
	});

	it('blocks coop start until at least two teams are active', () => {
		const room = createRoom();
		const leaderSocket = createSocket();

		room.settings.gameMode = 'coop';
		room.ownerId = 'leader';
		room.sessions.set('leader-session', leaderSocket);
		room.playerToSession.set('leader', 'leader-session');
		room.members.set('leader', {
			id: 'leader',
			sessionId: 'leader-session',
			userInfo: { username: 'leader', rating: 1200 },
			ready: true,
			teamId: 'team1',
			joinedAt: Date.now(),
		});
		room.members.set('player-2', {
			id: 'player-2',
			sessionId: 'player-session',
			userInfo: { username: 'player-2', rating: 1100 },
			ready: true,
			teamId: 'team1',
			joinedAt: Date.now() + 1,
		});

		room.handleStartRequest('leader');

		expect(leaderSocket.sentMessages[0]).toMatchObject({
			type: 'ROOM_ERROR',
			error: 'Each team must have at least one player',
		});
	});

	it('computes coop winner from team character totals', () => {
		const room = createRoom();
		const leaderSocket = createSocket();

		room.settings.gameMode = 'coop';
		room.sessions.set('leader-session', leaderSocket);
		room.ownerId = 'leader';
		room.members.set('leader', {
			id: 'leader',
			sessionId: 'leader-session',
			userInfo: { username: 'leader', rating: 1200 },
			ready: true,
			teamId: 'team1',
			joinedAt: Date.now(),
		});
		room.members.set('p2', {
			id: 'p2',
			sessionId: 'p2-session',
			userInfo: { username: 'p2', rating: 1100 },
			ready: true,
			teamId: 'team1',
			joinedAt: Date.now() + 1,
		});
		room.members.set('p3', {
			id: 'p3',
			sessionId: 'p3-session',
			userInfo: { username: 'p3', rating: 1000 },
			ready: true,
			teamId: 'team2',
			joinedAt: Date.now() + 2,
		});

		room.gameState = 'playing';
		room.game = {
			progress: new Map([
				['leader', { score: 2, correctChars: 10, currentWordIndex: 2 }],
				['p2', { score: 1, correctChars: 5, currentWordIndex: 1 }],
				['p3', { score: 4, correctChars: 12, currentWordIndex: 4 }],
			]),
		};

		room.endGame('timeout');

		const gameEnd = leaderSocket.sentMessages.find((msg) => msg.type === 'ROOM_GAME_END');
		expect(gameEnd.results.mode).toBe('coop');
		expect(gameEnd.results.winningTeamId).toBe('team1');
		expect(gameEnd.results.teamResults[0]).toMatchObject({
			teamId: 'team1',
			correctChars: 15,
		});
	});
});

describe('PrivateRoom persistence & recovery', () => {
	it('persists and restores room state across an eviction', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		room.createdAt = 123456789;
		room.settings.gameMode = 'coop';
		room.settings.roundTimeSeconds = 60;
		addMember(room, 'leader', { ready: true, teamId: 'team1' });
		addMember(room, 'p2', { teamId: 'team1' });
		await room.persistRoomState();

		const recovered = createRoomWithStorage(storage);
		await recovered.hydrate();

		expect(recovered.roomCode).toBe('ABCDEF');
		expect(recovered.ownerId).toBe('leader');
		expect(recovered.createdAt).toBe(123456789);
		expect(recovered.settings.roundTimeSeconds).toBe(60);
		expect(recovered.settings.gameMode).toBe('coop');
		expect(recovered.members.size).toBe(2);
		expect(recovered.members.get('leader').sessionId).toBeNull();
		expect(recovered.members.get('leader').ready).toBe(true);
		expect(recovered.members.get('leader').teamId).toBe('team1');
		expect(recovered.getSortedMembers().map((m) => m.id)).toEqual(['leader', 'p2']);
	});

	it('restores an in-progress game with its progress maps', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		addMember(room, 'leader');
		addMember(room, 'p2');
		makePlayingGame(room);

		await room.persistRoomState();

		const recovered = createRoomWithStorage(storage);
		await recovered.hydrate();

		expect(recovered.gameState).toBe('playing');
		expect(recovered.game.id).toBe('game-1');
		expect(recovered.game.seed).toBe('seed123');
		expect(recovered.game.words).toEqual(['alpha', 'bravo']);
		expect(recovered.game.progress.get('leader')).toMatchObject({ score: 2, correctChars: 10 });
		expect(recovered.game.progress.get('p2')).toMatchObject({ currentWordIndex: 1 });
		expect(typeof recovered.game.gameTimer).toBe('number');
		recovered.abortTimers();
	});

	it('finalizes a stale playing room whose deadline already passed', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		addMember(room, 'leader');
		addMember(room, 'p2');
		makePlayingGame(room, { endTimeInMs: -1000 });

		await room.persistRoomState();

		const recovered = createRoomWithStorage(storage);
		await recovered.hydrate();

		expect(recovered.gameState).toBe('lobby');
		expect(recovered.game).toBeNull();
	});

	it('self-heals a lost pending alarm on hydrate', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		addMember(room, 'leader');
		addMember(room, 'p2');
		makePlayingGame(room);
		room.alarmPurpose = 'game_end';
		room.alarmDeadline = room.game.endTime;
		await room.persistRoomState();

		// Simulate the alarm being lost between snapshot write and setAlarm.
		await storage.deleteAlarm();

		const recovered = createRoomWithStorage(storage);
		await recovered.hydrate();

		expect(storage.alarmValue()).toBe(room.game.endTime);
		expect(recovered.alarmPurpose).toBe('game_end');
		recovered.abortTimers();
	});

	it('arms a countdown-end alarm and resumes a mid-countdown room', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		addMember(room, 'leader', { ready: true });
		addMember(room, 'p2', { ready: true });

		room.startCountdown();
		await room.persistRoomState();

		expect(room.gameState).toBe('countdown');
		expect(room.alarmPurpose).toBe('countdown_end');
		expect(storage.alarmValue()).toBe(room.game.countdownEndsAt);

		room.abortTimers();

		const recovered = createRoomWithStorage(storage);
		await recovered.hydrate();

		expect(recovered.gameState).toBe('countdown');
		expect(recovered.game.countdown).toBeGreaterThan(0);
		recovered.abortTimers();
	});

	it('dispatches a countdown_end alarm on a cold wake into a fresh playing game', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		addMember(room, 'leader', { ready: true });
		addMember(room, 'p2', { ready: true });

		room.startCountdown();
		// Simulate eviction mid-countdown: the deadline passed while asleep.
		room.game.countdown = 0;
		room.game.countdownEndsAt = Date.now() - 1000;
		room.alarmPurpose = 'countdown_end';
		room.alarmDeadline = Date.now() - 1000;
		await room.persistRoomState();

		const recovered = createRoomWithStorage(storage);
		await recovered.alarm();

		expect(recovered.gameState).toBe('playing');
		expect(recovered.alarmPurpose).toBe('game_end');
		expect(recovered.game.endTime).toBeGreaterThan(Date.now());
		recovered.abortTimers();
	});

	it('deletes persisted state when the last member leaves', async () => {
		const storage = createFakeStorage();
		const room = createRoomWithStorage(storage);
		room.roomCode = 'ABCDEF';
		room.ownerId = 'leader';
		addMember(room, 'leader');
		room.sessions.set('session-leader', createSocket());
		room.playerToSession.set('leader', 'session-leader');
		await room.persistRoomState();

		expect(storage.keys()).toContain('roomState');

		room.handlePlayerLeave('leader');
		await room.deletePersistedState();

		expect(storage.keys()).not.toContain('roomState');
	});
});
