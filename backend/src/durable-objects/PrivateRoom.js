import { verifyFirebaseIdToken } from '../middleware/firebaseAuth.js';
import { generateSeed, generateWords, WORD_DIFFICULTIES } from '../utils/wordGenerator.js';

const MAX_PLAYER_INPUT_LENGTH = 32;

export const PRIVATE_ROOM_LIMITS = {
	minPlayers: 2,
	maxPlayers: 6,
	minRoundTimeSeconds: 20,
	maxRoundTimeSeconds: 300,
	minWordCount: 10,
	maxWordCount: 120,
};

const DEFAULT_ROOM_SETTINGS = {
	maxPlayers: 6,
	roundTimeSeconds: 60,
	wordCount: 30,
	gameMode: 'ffa', // 'ffa' or 'coop'
};

function toInteger(value, fallback) {
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return parsed;
}

export function normalizePrivateRoomSettings(rawSettings = {}, { currentMembers = 0 } = {}) {
	const maxPlayers = toInteger(rawSettings.maxPlayers, DEFAULT_ROOM_SETTINGS.maxPlayers);
	const roundTimeSeconds = toInteger(
		rawSettings.roundTimeSeconds,
		DEFAULT_ROOM_SETTINGS.roundTimeSeconds
	);
	const wordCount = toInteger(rawSettings.wordCount, DEFAULT_ROOM_SETTINGS.wordCount);
	const gameMode = rawSettings.gameMode === 'coop' ? 'coop' : 'ffa';

	if (maxPlayers < PRIVATE_ROOM_LIMITS.minPlayers || maxPlayers > PRIVATE_ROOM_LIMITS.maxPlayers) {
		return {
			error: `maxPlayers must be between ${PRIVATE_ROOM_LIMITS.minPlayers} and ${PRIVATE_ROOM_LIMITS.maxPlayers}`,
		};
	}

	if (maxPlayers < currentMembers) {
		return {
			error: 'maxPlayers cannot be lower than the current room size',
		};
	}

	if (
		roundTimeSeconds < PRIVATE_ROOM_LIMITS.minRoundTimeSeconds ||
		roundTimeSeconds > PRIVATE_ROOM_LIMITS.maxRoundTimeSeconds
	) {
		return {
			error: `roundTimeSeconds must be between ${PRIVATE_ROOM_LIMITS.minRoundTimeSeconds} and ${PRIVATE_ROOM_LIMITS.maxRoundTimeSeconds}`,
		};
	}

	if (wordCount < PRIVATE_ROOM_LIMITS.minWordCount || wordCount > PRIVATE_ROOM_LIMITS.maxWordCount) {
		return {
			error: `wordCount must be between ${PRIVATE_ROOM_LIMITS.minWordCount} and ${PRIVATE_ROOM_LIMITS.maxWordCount}`,
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

function sanitizeRoomCode(rawRoomCode) {
	if (typeof rawRoomCode !== 'string') return null;
	const code = rawRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	return code.length === 6 ? code : null;
}

export class PrivateRoom {
	constructor(controller, env) {
		this.controller = controller;
		this.env = env;

		this.sessions = new Map(); // sessionId -> socket
		this.sessionOrder = new Map(); // sessionId -> monotonic connection order
		this.playerToSession = new Map(); // playerId -> sessionId
		this.members = new Map(); // playerId -> member data
		this.nextSessionOrder = 0;

		this.roomCode = null;
		this.ownerId = null;
		this.createdAt = Date.now();
		this.settings = { ...DEFAULT_ROOM_SETTINGS };

		this.gameState = 'lobby';
		this.game = null;
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

		if (Number.isFinite(userInfo.rating)) {
			safe.rating = Math.max(0, Math.min(3000, Math.floor(userInfo.rating)));
		}

		return safe;
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

		return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
	}

	isSocketOpen(webSocket) {
		if (!webSocket) return false;

		const openStates = [WebSocket.OPEN, WebSocket.READY_STATE_OPEN, 1].filter((state) =>
			Number.isFinite(state)
		);
		return openStates.includes(webSocket.readyState);
	}

	extractRoomCodeFromPath(urlString) {
		try {
			const url = new URL(urlString);
			const match = url.pathname.match(/\/ws\/room\/([A-Za-z0-9]+)/);
			if (!match) return null;
			return sanitizeRoomCode(match[1]);
		} catch {
			return null;
		}
	}

	allPlayersReady() {
		if (this.members.size < 2) {
			return false;
		}

		// Leader is always considered ready - only check other members
		for (const member of this.members.values()) {
			if (member.id === this.ownerId) {
				continue; // Skip leader
			}
			if (!member.ready) {
				return false;
			}
		}

		return true;
	}

	canPlayerStartGame(playerId) {
		if (!playerId) return false;
		if (this.gameState !== 'lobby') return false;
		if (playerId !== this.ownerId) return false;
		return this.allPlayersReady();
	}

	getSortedMembers() {
		return Array.from(this.members.values()).sort((a, b) => a.joinedAt - b.joinedAt);
	}

	buildProgressList() {
		if (!this.game?.progress) {
			return [];
		}

		return this.getSortedMembers().map((member) => {
			const progress = this.game.progress.get(member.id) || {
				score: 0,
				currentWordIndex: 0,
			};

			return {
				playerId: member.id,
				username: member.userInfo.username,
				score: progress.score,
				currentWordIndex: progress.currentWordIndex,
			};
		});
	}

	buildRoomState(forPlayerId) {
		const members = this.getSortedMembers().map((member) => ({
			id: member.id,
			username: member.userInfo.username,
			rating: member.userInfo.rating,
			ready: member.ready,
			isLeader: member.id === this.ownerId,
			connected: Boolean(member.sessionId),
		}));

		const readyCount = members.filter((member) => member.ready).length;
		const allReady = this.allPlayersReady();

		const state = {
			type: 'ROOM_STATE',
			roomCode: this.roomCode,
			ownerId: this.ownerId,
			state: this.gameState,
			settings: this.settings,
			members,
			memberCount: members.length,
			readyCount,
			allReady,
			canStart: this.canPlayerStartGame(forPlayerId),
			createdAt: this.createdAt,
		};

		if (this.gameState === 'countdown' && this.game) {
			state.countdown = this.game.countdown ?? 0;
		}

		if (this.gameState === 'playing' && this.game) {
			state.game = {
				startTime: this.game.startTime,
				endTime: this.game.endTime,
				durationMs: Math.max(0, this.game.endTime - Date.now()),
				words: this.game.words,
				progress: this.buildProgressList(),
			};
		}

		return state;
	}

	abortTimers() {
		if (!this.game) return;

		if (this.game.countdownInterval) {
			clearInterval(this.game.countdownInterval);
		}
		if (this.game.startTimeout) {
			clearTimeout(this.game.startTimeout);
		}
		if (this.game.gameTimer) {
			clearTimeout(this.game.gameTimer);
		}
	}

	resetToLobby() {
		this.abortTimers();
		this.game = null;
		this.gameState = 'lobby';

		for (const member of this.members.values()) {
			member.ready = false;
		}
	}

	assignNewOwnerIfNeeded() {
		if (this.ownerId && this.members.has(this.ownerId)) {
			return;
		}

		const [nextOwner] = this.getSortedMembers();
		this.ownerId = nextOwner ? nextOwner.id : null;
	}

	handlePlayerLeave(playerId, reason = 'left') {
		const member = this.members.get(playerId);
		if (!member) {
			return;
		}

		this.members.delete(playerId);

		if (this.gameState === 'countdown' && this.members.size < 2) {
			this.resetToLobby();
		}

		if (this.gameState === 'playing') {
			this.endGame('player_left', { leftPlayerId: playerId });
		}

		if (this.ownerId === playerId) {
			this.ownerId = null;
			this.assignNewOwnerIfNeeded();
		}

		if (this.members.size === 0) {
			this.resetToLobby();
			this.ownerId = null;
		}

		this.sendToMembers({
			type: 'ROOM_MEMBER_LEFT',
			playerId,
			reason,
		});
		this.broadcastRoomState();
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

		this.playerToSession.delete(playerId);
		this.handlePlayerLeave(playerId, 'disconnected');
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

	sendToPlayer(sessionId, message) {
		if (typeof sessionId !== 'string' || sessionId.length === 0) {
			return;
		}

		const webSocket = this.sessions.get(sessionId);
		if (this.isSocketOpen(webSocket)) {
			try {
				webSocket.send(JSON.stringify(message));
			} catch (error) {
				console.error('Error sending room message:', error);
			}
		}
	}

	sendRoomError(sessionId, error) {
		this.sendToPlayer(sessionId, {
			type: 'ROOM_ERROR',
			error,
		});
	}

	sendToMembers(message) {
		for (const member of this.members.values()) {
			if (member.sessionId) {
				this.sendToPlayer(member.sessionId, message);
			}
		}
	}

	sendProgress() {
		this.sendToMembers({
			type: 'ROOM_PROGRESS',
			progress: this.buildProgressList(),
		});
	}

	broadcastRoomState() {
		for (const member of this.members.values()) {
			if (!member.sessionId) continue;
			this.sendToPlayer(member.sessionId, this.buildRoomState(member.id));
		}
	}

	updateSettings(playerId, rawSettings) {
		if (playerId !== this.ownerId) {
			const leaderSessionId = this.playerToSession.get(playerId);
			this.sendRoomError(leaderSessionId, 'Only the room leader can update settings');
			return;
		}

		if (this.gameState !== 'lobby') {
			const leaderSessionId = this.playerToSession.get(playerId);
			this.sendRoomError(leaderSessionId, 'Settings can only be changed in the lobby');
			return;
		}

		const normalized = normalizePrivateRoomSettings(rawSettings, {
			currentMembers: this.members.size,
		});
		if (normalized.error) {
			const leaderSessionId = this.playerToSession.get(playerId);
			this.sendRoomError(leaderSessionId, normalized.error);
			return;
		}

		this.settings = normalized.settings;
		this.broadcastRoomState();
	}

	startCountdown() {
		this.abortTimers();
		this.gameState = 'countdown';
		this.game = {
			countdown: 3,
			countdownInterval: null,
			startTimeout: null,
			gameTimer: null,
			words: [],
			progress: new Map(),
			startTime: null,
			endTime: null,
		};

		this.sendToMembers({
			type: 'ROOM_COUNTDOWN',
			count: this.game.countdown,
		});
		this.broadcastRoomState();

		this.game.countdownInterval = setInterval(() => {
			if (!this.game || this.gameState !== 'countdown') {
				return;
			}

			this.game.countdown -= 1;
			if (this.game.countdown > 0) {
				this.sendToMembers({
					type: 'ROOM_COUNTDOWN',
					count: this.game.countdown,
				});
				this.broadcastRoomState();
				return;
			}

			this.sendToMembers({
				type: 'ROOM_COUNTDOWN',
				count: 0,
			});

			clearInterval(this.game.countdownInterval);
			this.game.countdownInterval = null;
			this.game.startTimeout = setTimeout(() => {
				this.startGame();
			}, 450);
		}, 1000);
	}

	startGame() {
		if (!this.game || this.gameState !== 'countdown') {
			return;
		}

		if (this.members.size < 2 || !this.allPlayersReady()) {
			this.resetToLobby();
			this.broadcastRoomState();
			return;
		}

		const words = generateWords(generateSeed(), WORD_DIFFICULTIES.medium, this.settings.wordCount);
		const startTime = Date.now();
		const durationMs = this.settings.roundTimeSeconds * 1000;
		const endTime = startTime + durationMs;

		const progress = new Map();
		for (const member of this.members.values()) {
			progress.set(member.id, {
				score: 0,
				currentWordIndex: 0,
			});
			member.ready = false;
		}

		this.gameState = 'playing';
		this.game = {
			countdown: 0,
			countdownInterval: null,
			startTimeout: null,
			gameTimer: null,
			words,
			progress,
			startTime,
			endTime,
		};

		this.sendToMembers({
			type: 'ROOM_GAME_START',
			words,
			startTime,
			endTime,
			duration: durationMs,
		});
		this.sendProgress();
		this.broadcastRoomState();

		this.game.gameTimer = setTimeout(() => {
			this.endGame('timeout');
		}, durationMs);
	}

	endGame(reason = 'timeout', options = {}) {
		if (!this.game || (this.gameState !== 'playing' && this.gameState !== 'countdown')) {
			return;
		}

		const memberList = this.getSortedMembers();
		const rankings = memberList
			.map((member) => {
				const progress = this.game.progress?.get(member.id) || {
					score: 0,
					currentWordIndex: 0,
				};

				return {
					playerId: member.id,
					username: member.userInfo.username,
					score: progress.score,
					progress: progress.currentWordIndex,
				};
			})
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				if (b.progress !== a.progress) return b.progress - a.progress;
				return a.username.localeCompare(b.username);
			});

		let winnerId = options.winnerId || null;
		if (!winnerId && rankings.length > 0) {
			const [first, second] = rankings;
			if (!second || first.score !== second.score || first.progress !== second.progress) {
				winnerId = first.playerId;
			}
		}

		const isDraw = !winnerId;

		this.sendToMembers({
			type: 'ROOM_GAME_END',
			reason,
			results: {
				rankings,
				winnerId,
				isDraw,
				leftPlayerId: options.leftPlayerId || null,
			},
		});

		this.resetToLobby();
		this.broadcastRoomState();
	}

	handlePlayerInput(playerId, rawInput) {
		if (typeof rawInput !== 'string') return;
		if (this.gameState !== 'playing' || !this.game) return;
		if (!this.members.has(playerId)) return;

		const normalizedInput = rawInput.trim().toLowerCase();
		if (!normalizedInput || normalizedInput.length > MAX_PLAYER_INPUT_LENGTH) {
			return;
		}

		const progress = this.game.progress.get(playerId);
		if (!progress) {
			return;
		}

		const currentWord = this.game.words[progress.currentWordIndex];
		if (typeof currentWord !== 'string') {
			this.endGame('completed');
			return;
		}

		if (normalizedInput !== currentWord.toLowerCase()) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendToPlayer(sessionId, { type: 'ROOM_WRONG_WORD' });
			return;
		}

		progress.score += 1;
		progress.currentWordIndex += 1;
		this.sendProgress();
		this.broadcastRoomState();

		if (progress.currentWordIndex >= this.game.words.length) {
			this.endGame('completed', { winnerId: playerId });
		}
	}

	handleJoin(playerId, sessionId, message = {}) {
		const existingSessionId = this.playerToSession.get(playerId);
		if (
			existingSessionId &&
			existingSessionId !== sessionId &&
			this.getSessionOrder(existingSessionId) > this.getSessionOrder(sessionId)
		) {
			this.closeSession(sessionId, 1000, 'Superseded by newer session');
			return false;
		}

		if (existingSessionId && existingSessionId !== sessionId) {
			this.closeSession(existingSessionId, 1000, 'Replaced by newer session');
		}
		this.playerToSession.set(playerId, sessionId);

		const userInfo = this.sanitizeUserInfo(message.userInfo);
		const roomCodeFromMessage = sanitizeRoomCode(message.roomCode);
		if (!this.roomCode && roomCodeFromMessage) {
			this.roomCode = roomCodeFromMessage;
		}

		if (!this.ownerId) {
			this.ownerId = playerId;
		}

		let member = this.members.get(playerId);
		if (!member) {
			if (this.gameState !== 'lobby') {
				this.sendRoomError(sessionId, 'Room is in-game. Wait for the next lobby.');
				this.playerToSession.delete(playerId);
				return false;
			}

			if (this.members.size >= this.settings.maxPlayers) {
				this.sendRoomError(sessionId, 'Room is full');
				this.playerToSession.delete(playerId);
				return false;
			}

			member = {
				id: playerId,
				sessionId,
				userInfo,
				ready: false,
				joinedAt: Date.now(),
			};
			this.members.set(playerId, member);
		} else {
			member.sessionId = sessionId;
			member.userInfo = userInfo;
		}

		if (playerId === this.ownerId && message.settings && this.gameState === 'lobby') {
			const normalized = normalizePrivateRoomSettings(message.settings, {
				currentMembers: this.members.size,
			});
			if (!normalized.error) {
				this.settings = normalized.settings;
			}
		}

		this.broadcastRoomState();
		return true;
	}

	handleReady(playerId, ready) {
		if (this.gameState !== 'lobby') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Ready state can only be changed in the lobby');
			return;
		}

		const member = this.members.get(playerId);
		if (!member) {
			return;
		}

		member.ready = Boolean(ready);
		this.broadcastRoomState();
	}

	handleStartRequest(playerId) {
		if (playerId !== this.ownerId) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Only the room leader can start the game');
			return;
		}

		if (this.gameState !== 'lobby') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'A game is already in progress');
			return;
		}

		if (this.members.size < 2) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'At least two players are required to start');
			return;
		}

		if (!this.allPlayersReady()) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'All players must be ready before starting');
			return;
		}

		this.startCountdown();
	}

	async configureRoom(request) {
		const body = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') {
			return new Response(JSON.stringify({ error: 'Invalid payload' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		if (this.members.size > 0 || this.ownerId) {
			return new Response(JSON.stringify({ error: 'Room code already in use' }), {
				status: 409,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const roomCode = sanitizeRoomCode(body.roomCode);
		if (!roomCode) {
			return new Response(JSON.stringify({ error: 'Invalid room code' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const normalized = normalizePrivateRoomSettings(body.settings, {
			currentMembers: this.members.size,
		});
		if (normalized.error) {
			return new Response(JSON.stringify({ error: normalized.error }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		this.roomCode = roomCode;
		this.settings = normalized.settings;
		this.ownerId = typeof body.ownerId === 'string' && body.ownerId.length > 0 ? body.ownerId : null;
		this.createdAt = Date.now();

		return new Response(
			JSON.stringify({
				ok: true,
				roomCode: this.roomCode,
				settings: this.settings,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	async fetch(request) {
		const url = new URL(request.url);
		if (request.method === 'POST' && url.pathname.endsWith('/configure')) {
			return this.configureRoom(request);
		}

		const upgradeHeader = request.headers.get('upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response('Expected websocket', { status: 400 });
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.handleSession(server, request);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	handleSession(webSocket, request) {
		webSocket.accept();

		const sessionId = this.generateEntityId('private_session');
		this.sessions.set(sessionId, webSocket);
		this.sessionOrder.set(sessionId, this.nextSessionOrder++);

		const pathRoomCode = this.extractRoomCodeFromPath(request.url);
		if (!this.roomCode && pathRoomCode) {
			this.roomCode = pathRoomCode;
		}

		let playerId = null;

		webSocket.addEventListener('message', async (event) => {
			try {
				const message = this.parseMessage(event.data);
				if (!message || typeof message.type !== 'string') {
					return;
				}

				switch (message.type) {
					case 'ROOM_JOIN':
						try {
							playerId = await this.authenticateAndGetPlayerId(message);
							this.handleJoin(playerId, sessionId, message);
						} catch (error) {
							console.error('ROOM_JOIN failed:', error);
							this.sendRoomError(sessionId, 'Unauthorized');
							webSocket.close(1008, 'Unauthorized');
						}
						break;

					case 'ROOM_SET_READY':
						if (!playerId) {
							this.sendRoomError(sessionId, 'Join the room first');
							return;
						}
						this.handleReady(playerId, message.ready);
						break;

					case 'ROOM_UPDATE_SETTINGS':
						if (!playerId) {
							this.sendRoomError(sessionId, 'Join the room first');
							return;
						}
						this.updateSettings(playerId, message.settings);
						break;

					case 'ROOM_START_GAME':
						if (!playerId) {
							this.sendRoomError(sessionId, 'Join the room first');
							return;
						}
						this.handleStartRequest(playerId);
						break;

					case 'PLAYER_INPUT':
						if (!playerId) {
							this.sendRoomError(sessionId, 'Join the room first');
							return;
						}
						this.handlePlayerInput(playerId, message.input);
						break;

					case 'ROOM_LEAVE':
						if (playerId) {
							this.playerToSession.delete(playerId);
							this.handlePlayerLeave(playerId, 'left');
							playerId = null;
						}
						break;

					default:
						break;
				}
			} catch (error) {
				console.error('Error handling private room message:', error);
			}
		});

		webSocket.addEventListener('close', () => {
			this.handleSessionTermination(sessionId, playerId);
		});

		webSocket.addEventListener('error', (error) => {
			console.error('Private room socket error:', error);
			this.handleSessionTermination(sessionId, playerId);
		});
	}
}
