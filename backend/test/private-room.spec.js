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
});
