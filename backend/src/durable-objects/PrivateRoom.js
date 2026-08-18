import { generateSeed, generateWords, WORD_DIFFICULTIES } from '../utils/wordGenerator.js';
import { generateEntityId as createId } from '../services/ids.js';
import { persistRoomMatchResult } from '../services/match-results.js';
import { drizzle } from 'drizzle-orm/d1';
import { WSCoordinator } from './WSCoordinator.js';

const MAX_PLAYER_INPUT_LENGTH = 32;

export const PRIVATE_ROOM_LIMITS = {
	minPlayers: 2,
	maxPlayers: 8,
	minRoundTimeSeconds: 20,
	maxRoundTimeSeconds: 300,
	minWordCount: 10,
	maxWordCount: 120,
};

const DEFAULT_ROOM_SETTINGS = {
	maxPlayers: 8,
	roundTimeSeconds: 60,
	wordCount: 30,
	gameMode: 'ffa', // 'ffa' or 'coop'
	coopMode: 'normal', // 'normal' or 'switcher'
};

const COOP_MODES = {
	normal: 'normal',
	switcher: 'switcher',
};

const DEFAULT_TEAM_NAMES = ['Team Alpha', 'Team Beta', 'Team Gamma', 'Team Delta', 'Team Epsilon', 'Team Zeta'];

const ROOM_STATE_KEY = 'roomState';
const PROGRESS_PERSIST_INTERVAL_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;
const COUNTDOWN_START_MS = 3000;

function getDefaultTeamName(index) {
	return DEFAULT_TEAM_NAMES[index] || `Team ${index + 1}`;
}

function sanitizeTeamName(rawName, fallbackName) {
	if (typeof rawName !== 'string') {
		return fallbackName;
	}

	const compact = rawName.replace(/\s+/g, ' ');
	if (!compact.trim()) {
		return fallbackName;
	}

	return compact.slice(0, 24);
}

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
	const coopMode =
		rawSettings.coopMode === COOP_MODES.switcher
			? COOP_MODES.switcher
			: COOP_MODES.normal;

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
			coopMode,
		},
	};
}

function sanitizeRoomCode(rawRoomCode) {
	if (typeof rawRoomCode !== 'string') return null;
	const code = rawRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	return code.length === 6 ? code : null;
}

export class PrivateRoom extends WSCoordinator {
	constructor(controller, env) {
		super(controller, env);

		this.members = new Map(); // playerId -> member data

		this.roomCode = null;
		this.ownerId = null;
		this.createdAt = Date.now();
		this.settings = { ...DEFAULT_ROOM_SETTINGS };
		this.coopTeams = this.getDefaultCoopTeams();

		this.gameState = 'lobby';
		this.game = null;

		// Persistence & recovery: durable lifecycle state is mirrored into a
		// single `roomState` key so an eviction/restart can resume (or finalize)
		// the room. Connection state stays ephemeral. One alarm at a time with a
		// persisted purpose: 'countdown_end' | 'game_end'.
		this.hydrated = false;
		this.alarmPurpose = null;
		this.alarmDeadline = null;
		this.persistChain = Promise.resolve();
		this.lastProgressPersistAt = 0;
	}

	getDefaultCoopTeams(teamCount = 2) {
		const normalizedCount = Math.max(2, Math.min(PRIVATE_ROOM_LIMITS.maxPlayers, Number(teamCount) || 2));
		return Array.from({ length: normalizedCount }).map((_, index) => ({
			id: `team${index + 1}`,
			name: getDefaultTeamName(index),
		}));
	}

	resetCoopTeams(teamCount = this.coopTeams.length || 2) {
		this.coopTeams = this.getDefaultCoopTeams(teamCount);
		for (const member of this.members.values()) {
			member.teamId = null;
		}
	}

	// ----- Persistence & recovery -------------------------------------------

	buildPersistedState() {
		return {
			roomCode: this.roomCode,
			ownerId: this.ownerId,
			createdAt: this.createdAt,
			settings: this.settings,
			coopTeams: this.coopTeams,
			members: this.getSortedMembers().map((member) => ({
				id: member.id,
				userInfo: member.userInfo,
				ready: member.ready,
				teamId: member.teamId ?? null,
				joinedAt: member.joinedAt,
			})),
			gameState: this.gameState,
			game: this.serializeGame(),
			alarm:
				this.alarmPurpose && this.alarmDeadline
					? { purpose: this.alarmPurpose, deadline: this.alarmDeadline }
					: null,
		};
	}

	serializeGame() {
		if (!this.game) return null;

		const progress = {};
		for (const [playerId, entry] of this.game.progress.entries()) {
			progress[playerId] = { ...entry };
		}

		const teamProgress = {};
		if (this.game.teamProgress) {
			for (const [teamId, entry] of this.game.teamProgress.entries()) {
				teamProgress[teamId] = { ...entry };
			}
		}

		return {
			id: this.game.id ?? null,
			seed: this.game.seed ?? null,
			countdown: this.game.countdown ?? 0,
			countdownEndsAt: this.game.countdownEndsAt ?? null,
			words: this.game.words ?? [],
			progress,
			teamProgress,
			startTime: this.game.startTime ?? null,
			endTime: this.game.endTime ?? null,
		};
	}

	deserializeGame(savedGame) {
		if (!savedGame) return null;

		const progress = new Map();
		for (const [playerId, entry] of Object.entries(savedGame.progress ?? {})) {
			progress.set(playerId, { ...entry });
		}

		const teamProgress = new Map();
		for (const [teamId, entry] of Object.entries(savedGame.teamProgress ?? {})) {
			teamProgress.set(teamId, { ...entry });
		}

		return {
			id: savedGame.id ?? null,
			seed: savedGame.seed ?? null,
			countdown: savedGame.countdown ?? 0,
			countdownEndsAt: savedGame.countdownEndsAt ?? null,
			countdownInterval: null,
			startTimeout: null,
			gameTimer: null,
			words: savedGame.words ?? [],
			progress,
			teamProgress,
			startTime: savedGame.startTime ?? null,
			endTime: savedGame.endTime ?? null,
		};
	}

	// Serialized writes keep snapshot ordering stable when lifecycle mutations
	// persist fire-and-forget from synchronous handlers.
	persistRoomState() {
		if (!this.storage?.put) return Promise.resolve();
		this.persistChain = this.persistChain
			.catch(() => {})
			.then(() => this.storage.put(ROOM_STATE_KEY, this.buildPersistedState()))
			.catch((error) => console.error('Failed to persist room state:', error));
		return this.persistChain;
	}

	deletePersistedState() {
		if (!this.storage?.delete) return Promise.resolve();
		this.persistChain = this.persistChain
			.catch(() => {})
			.then(() => this.storage.delete(ROOM_STATE_KEY))
			.catch((error) => console.error('Failed to delete persisted room state:', error));
		return this.persistChain;
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

		this.roomCode = saved.roomCode ?? null;
		this.ownerId = saved.ownerId ?? null;
		this.createdAt = saved.createdAt ?? Date.now();
		this.settings = saved.settings
			? { ...DEFAULT_ROOM_SETTINGS, ...saved.settings }
			: { ...DEFAULT_ROOM_SETTINGS };
		this.coopTeams = Array.isArray(saved.coopTeams)
			? saved.coopTeams
			: this.getDefaultCoopTeams();

		this.members.clear();
		for (const member of saved.members ?? []) {
			if (!member || typeof member.id !== 'string') continue;
			this.members.set(member.id, {
				id: member.id,
				sessionId: null, // ephemeral — re-established on ROOM_JOIN
				userInfo: this.sanitizeUserInfo(member.userInfo),
				ready: Boolean(member.ready),
				teamId: member.teamId ?? null,
				joinedAt: member.joinedAt ?? Date.now(),
			});
		}

		this.gameState = saved.gameState ?? 'lobby';
		this.game = this.deserializeGame(saved.game);
		if (saved.alarm) {
			this.alarmPurpose = saved.alarm.purpose ?? null;
			this.alarmDeadline = saved.alarm.deadline ?? null;
		}

		// Resume a mid-round room or finalize a stale one so recovery can never
		// stall in 'playing' or 'countdown' after an eviction mid-flight.
		if (this.gameState === 'playing' && this.game?.endTime) {
			if (this.game.endTime <= Date.now()) {
				await this.endGame('timeout');
			} else {
				this.resumeGameTimer();
			}
		} else if (this.gameState === 'countdown' && this.game) {
			await this.resumeCountdown();
		}

		// Self-healing: if a pending alarm was lost (e.g. a crash between the
		// snapshot write and setAlarm), re-arm it from persisted state.
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

	async armCountdownEndAlarm(deadline) {
		this.alarmPurpose = 'countdown_end';
		this.alarmDeadline = deadline;
		await this.persistRoomState();
		if (this.storage?.setAlarm) {
			try {
				await this.storage.setAlarm(deadline);
			} catch (error) {
				console.error('Failed to arm countdown alarm:', error);
			}
		}
	}

	async armGameEndAlarm(endTime) {
		this.alarmPurpose = 'game_end';
		this.alarmDeadline = endTime;
		await this.persistRoomState();
		if (this.storage?.setAlarm) {
			try {
				await this.storage.setAlarm(endTime);
			} catch (error) {
				console.error('Failed to arm game-end alarm:', error);
			}
		}
	}

	// Single alarm at a time: purpose is persisted so the handler knows what
	// fired even after a restart. Alarms are durable, so a pending round timer
	// survives DO eviction and fires here on wake.
	async alarm() {
		// On a cold wake this.alarmPurpose is null until hydrate() loads it,
		// and hydrate() may itself transition the room (e.g. an expired
		// countdown resumes straight into 'playing', re-arming a game_end
		// alarm). Read the fired purpose from storage first so we dispatch on
		// what actually fired, not on whatever hydrate() left behind.
		let purpose = this.alarmPurpose;
		if (!purpose && this.storage?.get) {
			try {
				const saved = await this.storage.get(ROOM_STATE_KEY);
				purpose = saved?.alarm?.purpose ?? null;
			} catch (error) {
				console.error('Failed to read alarm purpose:', error);
			}
		}

		await this.hydrate();

		if (purpose === 'countdown_end') {
			if (this.gameState === 'countdown') {
				this.clearAlarmState();
				this.finishCountdownAndStart();
			}
			// If hydrate already advanced to 'playing', startGame armed the
			// game_end alarm — leave it intact rather than clobbering it.
		} else if (purpose === 'game_end') {
			this.clearAlarmState();
			if (this.gameState === 'playing') {
				this.endGame('timeout');
			}
		}

		await this.persistRoomState();
	}

	// Resumes a restored 'playing' round's wall-clock timer. The durable alarm
	// remains the backstop; this only recreates the in-memory timer.
	resumeGameTimer() {
		if (!this.game?.endTime) return;
		const remainingMs = Math.max(0, this.game.endTime - Date.now());
		if (remainingMs > 0) {
			this.game.gameTimer = setTimeout(() => {
				this.endGame('timeout');
			}, remainingMs);
		}
	}

	async resumeCountdown() {
		if (!this.game || this.gameState !== 'countdown') return;

		const remainingMs = (this.game.countdownEndsAt ?? Date.now()) - Date.now();
		if (remainingMs <= 0) {
			this.finalizeCountdown();
			this.startGame();
			return;
		}

		this.game.countdown = Math.max(1, Math.ceil(remainingMs / COUNTDOWN_TICK_MS));
		this.game.countdownInterval = setInterval(() => {
			if (!this.game || this.gameState !== 'countdown') return;
			this.game.countdown -= 1;
			if (this.game.countdown > 0) {
				this.sendToMembers({ type: 'ROOM_COUNTDOWN', count: this.game.countdown });
				this.broadcastRoomState();
				return;
			}
			this.finishCountdownAndStart();
		}, COUNTDOWN_TICK_MS);
	}

	finalizeCountdown() {
		if (!this.game || this.gameState !== 'countdown') return;
		if (this.game.countdownInterval) {
			clearInterval(this.game.countdownInterval);
			this.game.countdownInterval = null;
		}
		if (this.game.countdown > 0) {
			this.sendToMembers({ type: 'ROOM_COUNTDOWN', count: 0 });
		}
		this.game.countdown = 0;
	}

	finishCountdownAndStart() {
		if (!this.game || this.gameState !== 'countdown') return;
		if (this.game.startTimeout) return; // already scheduled (interval + alarm can both fire)
		this.finalizeCountdown();
		this.game.startTimeout = setTimeout(() => {
			this.startGame();
		}, 450);
	}

	persistProgressIfDue() {
		const now = Date.now();
		if (now - this.lastProgressPersistAt >= PROGRESS_PERSIST_INTERVAL_MS) {
			this.lastProgressPersistAt = now;
			void this.persistRoomState();
		}
	}

	buildTeamState() {
		const teamNames = new Map(this.coopTeams.map((team) => [team.id, team.name]));
		return this.coopTeams.map((team) => ({
			id: team.id,
			name: team.name,
			memberIds: this.getSortedMembers()
				.filter((member) => member.teamId === team.id)
				.map((member) => member.id),
			defaultName: getDefaultTeamName(this.coopTeams.findIndex((entry) => entry.id === team.id)),
			canRename: true,
			label: teamNames.get(team.id) || team.name,
		}));
	}

	validateCoopTeamRequirements() {
		if (this.settings.gameMode !== 'coop') {
			return { ok: true };
		}

		const memberList = this.getSortedMembers();
		if (memberList.length < 2) {
			return { ok: false, error: 'At least two players are required to start' };
		}

		const teamCounts = new Map(this.coopTeams.map((team) => [team.id, 0]));
		for (const member of memberList) {
			if (!member.teamId || !teamCounts.has(member.teamId)) {
				return { ok: false, error: 'All players must join a team before readying up' };
			}
			teamCounts.set(member.teamId, (teamCounts.get(member.teamId) || 0) + 1);
		}

		if (this.coopTeams.length > memberList.length) {
			return { ok: false, error: 'Team count cannot exceed joined players' };
		}

		const hasEmptyTeam = Array.from(teamCounts.values()).some((count) => count === 0);
		if (hasEmptyTeam) {
			return { ok: false, error: 'Each team must have at least one player' };
		}

		return { ok: true };
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
		if (this.settings.gameMode === 'coop' && !this.validateCoopTeamRequirements().ok) return false;
		return this.allPlayersReady();
	}

	getSortedMembers() {
		return Array.from(this.members.values()).sort((a, b) => a.joinedAt - b.joinedAt);
	}

	buildProgressList() {
		if (!this.game?.progress) {
			return [];
		}

		const isSwitcherCoop =
			this.settings.gameMode === 'coop' &&
			this.settings.coopMode === COOP_MODES.switcher &&
			this.game?.teamProgress;

		return this.getSortedMembers().map((member) => {
			const progress = this.game.progress.get(member.id) || {
				score: 0,
				correctChars: 0,
				currentWordIndex: 0,
			};
			const teamProgress =
				isSwitcherCoop && member.teamId ? this.game.teamProgress.get(member.teamId) : null;
			const activePlayerId =
				teamProgress && Array.isArray(teamProgress.memberIds)
					? teamProgress.memberIds[teamProgress.activeMemberIndex] || null
					: null;

			return {
				playerId: member.id,
				username: member.userInfo.username,
				score: progress.score,
				correctChars: progress.correctChars,
				currentWordIndex: teamProgress?.currentWordIndex ?? progress.currentWordIndex,
				isActiveTurn: activePlayerId === member.id,
			};
		});
	}

	buildTeamTurnState() {
		if (!this.game?.teamProgress) {
			return {};
		}

		const state = {};
		for (const [teamId, teamProgress] of this.game.teamProgress.entries()) {
			const activePlayerId =
				Array.isArray(teamProgress.memberIds) && teamProgress.memberIds.length > 0
					? teamProgress.memberIds[teamProgress.activeMemberIndex] || teamProgress.memberIds[0]
					: null;

			state[teamId] = {
				teamId,
				activePlayerId,
				currentWordIndex: teamProgress.currentWordIndex,
				currentInput: teamProgress.currentInput || '',
				score: teamProgress.score,
				correctChars: teamProgress.correctChars,
			};
		}

		return state;
	}

	buildRoomState(forPlayerId) {
		const members = this.getSortedMembers().map((member) => ({
			id: member.id,
			username: member.userInfo.username,
			rating: member.userInfo.rating,
			ready: member.ready,
			isLeader: member.id === this.ownerId,
			teamId: member.teamId || null,
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
			teams: this.settings.gameMode === 'coop' ? this.buildTeamState() : [],
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
				teamTurnState: this.buildTeamTurnState(),
				coopMode: this.settings.coopMode || COOP_MODES.normal,
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
		if (this.settings.gameMode === 'coop') {
			this.resetCoopTeams();
		}

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
			void this.deletePersistedState();
		} else {
			void this.persistRoomState();
		}

		this.sendToMembers({
			type: 'ROOM_MEMBER_LEFT',
			playerId,
			reason,
		});
		this.broadcastRoomState();
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

	sendToTeamMembers(teamId, message) {
		if (!teamId) return;
		for (const member of this.members.values()) {
			if (member.teamId !== teamId) continue;
			if (!member.sessionId) continue;
			this.sendToPlayer(member.sessionId, message);
		}
	}

	sendProgress() {
		this.sendToMembers({
			type: 'ROOM_PROGRESS',
			progress: this.buildProgressList(),
			teamTurnState: this.buildTeamTurnState(),
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
		if (this.settings.gameMode === 'coop') {
			this.resetCoopTeams();
		} else {
			for (const member of this.members.values()) {
				member.teamId = null;
			}
		}
		for (const member of this.members.values()) {
			member.ready = false;
		}
		void this.persistRoomState();
		this.broadcastRoomState();
	}

	startCountdown() {
		this.abortTimers();
		this.gameState = 'countdown';
		this.game = {
			countdown: 3,
			countdownEndsAt: Date.now() + COUNTDOWN_START_MS,
			countdownInterval: null,
			startTimeout: null,
			gameTimer: null,
			words: [],
			progress: new Map(),
			teamProgress: new Map(),
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

			this.finishCountdownAndStart();
		}, COUNTDOWN_TICK_MS);

		void this.armCountdownEndAlarm(this.game.countdownEndsAt);
	}

	startGame() {
		if (!this.game || this.gameState !== 'countdown') {
			return;
		}

		if (this.members.size < 2 || !this.allPlayersReady()) {
			this.resetToLobby();
			void this.persistRoomState();
			this.broadcastRoomState();
			return;
		}

		const seed = generateSeed();
		const words = generateWords(seed, WORD_DIFFICULTIES.medium, this.settings.wordCount);
		const startTime = Date.now();
		const durationMs = this.settings.roundTimeSeconds * 1000;
		const endTime = startTime + durationMs;

		const progress = new Map();
		const teamProgress = new Map();
		for (const member of this.members.values()) {
			progress.set(member.id, {
				score: 0,
				correctChars: 0,
				currentWordIndex: 0,
			});
			member.ready = false;
		}

		if (this.settings.gameMode === 'coop' && this.settings.coopMode === COOP_MODES.switcher) {
			for (const team of this.coopTeams) {
				const teamMembers = this.getSortedMembers().filter((member) => member.teamId === team.id);
				if (teamMembers.length === 0) continue;

				teamProgress.set(team.id, {
					teamId: team.id,
					memberIds: teamMembers.map((member) => member.id),
					activeMemberIndex: 0,
					currentWordIndex: 0,
					score: 0,
					correctChars: 0,
					currentInput: '',
				});
			}
		}

		this.gameState = 'playing';
		this.game = {
			id: createId('game'),
			seed,
			countdown: 0,
			countdownEndsAt: null,
			countdownInterval: null,
			startTimeout: null,
			gameTimer: null,
			words,
			progress,
			teamProgress,
			startTime,
			endTime,
		};

		this.sendToMembers({
			type: 'ROOM_GAME_START',
			words,
			startTime,
			endTime,
			duration: durationMs,
			coopMode: this.settings.coopMode || COOP_MODES.normal,
			teamTurnState: this.buildTeamTurnState(),
		});
		this.sendProgress();
		this.broadcastRoomState();

		this.game.gameTimer = setTimeout(() => {
			this.endGame('timeout');
		}, durationMs);

		void this.armGameEndAlarm(this.game.endTime);
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
					correctChars: 0,
					currentWordIndex: 0,
				};

				return {
					playerId: member.id,
					username: member.userInfo.username,
					score: progress.score,
					correctChars: progress.correctChars,
					teamId: member.teamId || null,
					progress: progress.currentWordIndex,
				};
			})
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				if (b.progress !== a.progress) return b.progress - a.progress;
				return a.username.localeCompare(b.username);
			});

		let winnerId = options.winnerId || null;
		let winningTeamId = null;
		let teamResults = [];
		let isDraw = false;

		if (this.settings.gameMode === 'coop') {
			winnerId = null;
			const byTeam = new Map(this.coopTeams.map((team) => [team.id, {
				teamId: team.id,
				name: team.name,
				score: 0,
				correctChars: 0,
				members: [],
			}]));

			for (const row of rankings) {
				if (!row.teamId || !byTeam.has(row.teamId)) continue;
				const teamBucket = byTeam.get(row.teamId);
				teamBucket.score += row.score;
				teamBucket.correctChars += row.correctChars;
				teamBucket.members.push({
					playerId: row.playerId,
					username: row.username,
					score: row.score,
					correctChars: row.correctChars,
					progress: row.progress,
				});
			}

			teamResults = Array.from(byTeam.values())
				.filter((team) => team.members.length > 0)
				.sort((a, b) => {
					if (b.correctChars !== a.correctChars) return b.correctChars - a.correctChars;
					if (b.score !== a.score) return b.score - a.score;
					return a.name.localeCompare(b.name);
				});

			const [firstTeam, secondTeam] = teamResults;
			if (!firstTeam || !secondTeam) {
				isDraw = true;
			} else if (
				firstTeam.correctChars === secondTeam.correctChars &&
				firstTeam.score === secondTeam.score
			) {
				isDraw = true;
			} else {
				winningTeamId = firstTeam.teamId;
				winnerId = rankings.find((entry) => entry.teamId === winningTeamId)?.playerId || null;
			}
		} else {
			if (!winnerId && rankings.length > 0) {
				const [first, second] = rankings;
				if (!second || first.score !== second.score || first.progress !== second.progress) {
					winnerId = first.playerId;
				}
			}

			isDraw = !winnerId;
		}

		if (this.env?.DB) {
			persistRoomMatchResult(drizzle(this.env.DB), {
				gameId: this.game.id,
				roomCode: this.roomCode || null,
				mode: this.settings.gameMode,
				modeSeconds: this.settings.roundTimeSeconds,
				difficulty: WORD_DIFFICULTIES.medium,
				seed: this.game.seed,
				startedAt: this.game.startTime ? new Date(this.game.startTime) : null,
				endedAt: new Date(),
				players: rankings.map((row, index) => ({
					id: row.playerId,
					placement: index + 1,
					score: row.score,
					progress: row.progress,
					correctChars: row.correctChars,
				})),
				winnerId,
				isDraw,
			}).catch((error) => console.error('Failed to persist room match result:', error));
		}

		this.sendToMembers({
			type: 'ROOM_GAME_END',
			reason,
			results: {
				mode: this.settings.gameMode,
				rankings,
				winnerId,
				winningTeamId,
				teamResults,
				isDraw,
				leftPlayerId: options.leftPlayerId || null,
			},
		});

		this.resetToLobby();
		this.lastProgressPersistAt = 0;
		void this.clearAlarm();
		void this.persistRoomState();
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

		if (this.settings.gameMode === 'coop' && this.settings.coopMode === COOP_MODES.switcher) {
			const member = this.members.get(playerId);
			if (!member?.teamId) return;

			const teamProgress = this.game.teamProgress?.get(member.teamId);
			if (!teamProgress || !Array.isArray(teamProgress.memberIds) || teamProgress.memberIds.length === 0) {
				return;
			}

			const activePlayerId =
				teamProgress.memberIds[teamProgress.activeMemberIndex] || teamProgress.memberIds[0];
			if (activePlayerId !== playerId) {
				const sessionId = this.playerToSession.get(playerId);
				this.sendRoomError(sessionId, 'Wait for your turn');
				return;
			}

			const currentWord = this.game.words[teamProgress.currentWordIndex];
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
			progress.correctChars += currentWord.length;
			teamProgress.score += 1;
			teamProgress.correctChars += currentWord.length;
			teamProgress.currentWordIndex += 1;
			teamProgress.currentInput = '';

			for (const memberId of teamProgress.memberIds) {
				const memberProgress = this.game.progress.get(memberId);
				if (memberProgress) {
					memberProgress.currentWordIndex = teamProgress.currentWordIndex;
				}
			}

			teamProgress.activeMemberIndex =
				(teamProgress.activeMemberIndex + 1) % teamProgress.memberIds.length;

			this.sendProgress();

			this.persistProgressIfDue();

			if (teamProgress.currentWordIndex >= this.game.words.length) {
				this.endGame('completed', { winnerId: playerId });
			}

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
		progress.correctChars += currentWord.length;
		progress.currentWordIndex += 1;
		this.sendProgress();
		this.persistProgressIfDue();

		if (progress.currentWordIndex >= this.game.words.length) {
			this.endGame('completed', { winnerId: playerId });
		}
	}

	handlePlayerTyping(playerId, rawInput) {
		if (typeof rawInput !== 'string') return;
		if (this.gameState !== 'playing' || !this.game) return;
		if (this.settings.gameMode !== 'coop' || this.settings.coopMode !== COOP_MODES.switcher) return;

		const member = this.members.get(playerId);
		if (!member?.teamId) return;

		const teamProgress = this.game.teamProgress?.get(member.teamId);
		if (!teamProgress || !Array.isArray(teamProgress.memberIds) || teamProgress.memberIds.length === 0) {
			return;
		}

		const activePlayerId = teamProgress.memberIds[teamProgress.activeMemberIndex] || teamProgress.memberIds[0];
		if (activePlayerId !== playerId) {
			return;
		}

		const currentWord = this.game.words[teamProgress.currentWordIndex] || '';
		const typedInput = String(rawInput || '').replace(/\s/g, '').slice(0, currentWord.length);
		teamProgress.currentInput = typedInput;
		this.persistProgressIfDue();
		this.sendToTeamMembers(member.teamId, {
			type: 'ROOM_TEAM_TYPING',
			teamId: member.teamId,
			activePlayerId,
			currentWordIndex: teamProgress.currentWordIndex,
			currentInput: typedInput,
		});
	}

	handleJoin(playerId, sessionId, message = {}) {
		if (!this.ownerId) {
			this.sendRoomError(sessionId, 'Room not found');
			return false;
		}

		if (!this.claimSession(playerId, sessionId)) {
			return false;
		}

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
				teamId: null,
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

		void this.persistRoomState();
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

		if (this.settings.gameMode === 'coop' && ready) {
			if (!member.teamId || !this.coopTeams.some((team) => team.id === member.teamId)) {
				const sessionId = this.playerToSession.get(playerId);
				this.sendRoomError(sessionId, 'Join a valid team before setting ready');
				return;
			}
		}

		member.ready = Boolean(ready);
		void this.persistRoomState();
		this.broadcastRoomState();
	}

	handleAssignTeam(playerId, teamId) {
		if (this.gameState !== 'lobby') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Team assignment can only be changed in the lobby');
			return;
		}

		if (this.settings.gameMode !== 'coop') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Team assignment is only available in coop mode');
			return;
		}

		const member = this.members.get(playerId);
		if (!member) return;

		if (!this.coopTeams.some((team) => team.id === teamId)) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Invalid team selected');
			return;
		}

		member.teamId = teamId;
		member.ready = false;
		void this.persistRoomState();
		this.broadcastRoomState();
	}

	handleSetTeamName(playerId, teamId, name) {
		if (this.gameState !== 'lobby') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Team names can only be changed in the lobby');
			return;
		}

		if (this.settings.gameMode !== 'coop') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Team names are only available in coop mode');
			return;
		}

		const teamIndex = this.coopTeams.findIndex((team) => team.id === teamId);
		if (teamIndex === -1) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Invalid team');
			return;
		}

		const fallback = getDefaultTeamName(teamIndex);
		this.coopTeams[teamIndex] = {
			...this.coopTeams[teamIndex],
			name: sanitizeTeamName(name, fallback),
		};
		void this.persistRoomState();
		this.broadcastRoomState();
	}

	handleAddTeam(playerId) {
		if (playerId !== this.ownerId) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Only the room leader can add teams');
			return;
		}

		if (this.gameState !== 'lobby') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Teams can only be changed in the lobby');
			return;
		}

		if (this.settings.gameMode !== 'coop') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Teams are only available in coop mode');
			return;
		}

		if (this.coopTeams.length >= this.members.size) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Team count cannot exceed joined players');
			return;
		}

		const nextIndex = this.coopTeams.length;
		this.coopTeams.push({
			id: `team${nextIndex + 1}`,
			name: getDefaultTeamName(nextIndex),
		});

		for (const member of this.members.values()) {
			member.ready = false;
		}

		void this.persistRoomState();
		this.broadcastRoomState();
	}

	handleRemoveTeam(playerId, teamId) {
		if (playerId !== this.ownerId) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Only the room leader can remove teams');
			return;
		}

		if (this.gameState !== 'lobby') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Teams can only be changed in the lobby');
			return;
		}

		if (this.settings.gameMode !== 'coop') {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Teams are only available in coop mode');
			return;
		}

		if (this.coopTeams.length <= 2) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'At least two teams are required');
			return;
		}

		const teamIndex = this.coopTeams.findIndex((team) => team.id === teamId);
		if (teamIndex === -1) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Invalid team');
			return;
		}

		const hasAssignedPlayers = this.getSortedMembers().some((member) => member.teamId === teamId);
		if (hasAssignedPlayers) {
			const sessionId = this.playerToSession.get(playerId);
			this.sendRoomError(sessionId, 'Move players out before removing this team');
			return;
		}

		this.coopTeams.splice(teamIndex, 1);
		for (const member of this.members.values()) {
			member.ready = false;
		}
		void this.persistRoomState();
		this.broadcastRoomState();
	}

	handleRematchRequest(playerId) {
		this.handleStartRequest(playerId);
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

		if (this.settings.gameMode === 'coop') {
			const validation = this.validateCoopTeamRequirements();
			if (!validation.ok) {
				const sessionId = this.playerToSession.get(playerId);
				this.sendRoomError(sessionId, validation.error || 'Invalid coop team setup');
				return;
			}
		}

		this.startCountdown();
	}

	async configureRoom(request) {
		await this.hydrate();

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
		this.coopTeams = this.getDefaultCoopTeams();
		this.ownerId = typeof body.ownerId === 'string' && body.ownerId.length > 0 ? body.ownerId : null;
		this.createdAt = Date.now();
		void this.persistRoomState();

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

	async roomStatus(request) {
		await this.hydrate();

		const exists = Boolean(this.ownerId);
		const maxPlayers = this.settings?.maxPlayers ?? DEFAULT_ROOM_SETTINGS.maxPlayers;

		return new Response(
			JSON.stringify({
				code: this.roomCode,
				exists,
				live: exists && this.members.size > 0,
				full: exists && this.members.size >= maxPlayers,
				inProgress: exists && this.gameState !== 'lobby',
				memberCount: this.members.size,
				maxPlayers,
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

		if (request.method === 'GET' && url.pathname.endsWith('/status')) {
			return this.roomStatus(request);
		}

		const upgradeHeader = request.headers.get('upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response('Expected websocket', { status: 400 });
		}

		await this.hydrate();

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.handleSession(server, request);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	handleSession(webSocket, request) {
		const pathRoomCode = this.extractRoomCodeFromPath(request?.url);
		if (!this.roomCode && pathRoomCode) {
			this.roomCode = pathRoomCode;
		}

		super.handleSession(webSocket, request);
	}

	generateSessionId() {
		return createId('private_session');
	}

	handlePlayerDisconnect(playerId) {
		this.handlePlayerLeave(playerId, 'disconnected');
	}

	async handleMessage(message, ctx) {
		const { sessionId, webSocket, getPlayerId, setPlayerId } = ctx;

		switch (message.type) {
			case 'ROOM_JOIN':
				try {
					const joinedPlayerId = await this.authenticateAndGetPlayerId(message);
					setPlayerId(joinedPlayerId);
					this.handleJoin(joinedPlayerId, sessionId, message);
				} catch (error) {
					console.error('ROOM_JOIN failed:', error);
					this.sendRoomError(sessionId, 'Unauthorized');
					webSocket.close(1008, 'Unauthorized');
				}
				break;

			case 'ROOM_SET_READY':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleReady(getPlayerId(), message.ready);
				break;

			case 'ROOM_UPDATE_SETTINGS':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.updateSettings(getPlayerId(), message.settings);
				break;

			case 'ROOM_ASSIGN_TEAM':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleAssignTeam(getPlayerId(), message.teamId);
				break;

			case 'ROOM_SET_TEAM_NAME':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleSetTeamName(getPlayerId(), message.teamId, message.name);
				break;

			case 'ROOM_START_GAME':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleStartRequest(getPlayerId());
				break;

			case 'ROOM_ADD_TEAM':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleAddTeam(getPlayerId());
				break;

			case 'ROOM_REMOVE_TEAM':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleRemoveTeam(getPlayerId(), message.teamId);
				break;

			case 'ROOM_REMATCH':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handleRematchRequest(getPlayerId());
				break;

			case 'PLAYER_INPUT':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handlePlayerInput(getPlayerId(), message.input);
				break;

			case 'PLAYER_TYPING':
				if (!getPlayerId()) {
					this.sendRoomError(sessionId, 'Join the room first');
					return;
				}
				this.handlePlayerTyping(getPlayerId(), message.input);
				break;

			case 'ROOM_LEAVE':
				if (getPlayerId()) {
					this.playerToSession.delete(getPlayerId());
					this.handlePlayerLeave(getPlayerId(), 'left');
					setPlayerId(null);
				}
				break;

			default:
				break;
		}
	}
}
