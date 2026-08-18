import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameRoom } from '../src/durable-objects/GameRoom.js';
import { matchParticipants, matches, rankedGameLogs, userModeStats, users } from '../src/db/schema.js';
import { getHighestModeRating } from '../src/services/user-stats.js';
import { persistRankedMatchResult, persistRoomMatchResult } from '../src/services/match-results.js';
import { GAME_STATUS_FINISHED } from '../src/config.js';
import m0000 from '../migrations/0000_even_oracle.sql?raw';
import m0001 from '../migrations/0001_bent_puck.sql?raw';
import m0002 from '../migrations/0002_candid_anchor.sql?raw';
import m0003 from '../migrations/0003_rated_modes.sql?raw';
import m0004 from '../migrations/0004_solid_harbor.sql?raw';
import m0005 from '../migrations/0005_profile_location.sql?raw';
import m0006 from '../migrations/0006_presence_and_room_invites.sql?raw';
import m0007 from '../migrations/0007_user_avatar_id.sql?raw';
import m0008 from '../migrations/0008_match_persistence.sql?raw';
import m0009 from '../migrations/0009_drop_avatar_id.sql?raw';
import m0010 from '../migrations/0010_foreign_keys.sql?raw';

const MIGRATIONS = [m0000, m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009, m0010];

// The test pool runs a local (non-remote) D1; apply the schema exactly once.
// exec() in the pool rejects multi-line statements, so each statement is
// collapsed onto a single line before execution.
async function ensureSchema() {
	const { results } = await env.DB.prepare(
		"select name from sqlite_master where type='table' and name='users'"
	).all();
	if (results.length > 0) {
		return;
	}
	for (const sql of MIGRATIONS) {
		const statements = sql
			.split('--> statement-breakpoint')
			.flatMap((chunk) => chunk.split(';'))
			.map((statement) => statement.replace(/\s+/g, ' ').trim())
			.filter((statement) => statement.length > 0 && !statement.startsWith('-->'));
		for (const statement of statements) {
			await env.DB.exec(statement);
		}
	}
	// schema.js maps `nextWordCondition` but no committed migration adds the
	// column (schema drift against the remote DB). Keep tests aligned.
	const { results: colCheck } = await env.DB.prepare(
		"select name from pragma_table_info('users') where name = 'next_word_condition'"
	).all();
	if (colCheck.length === 0) {
		await env.DB.exec("ALTER TABLE users ADD COLUMN next_word_condition text NOT NULL DEFAULT 'auto'");
	}
}

// Exercises the DO -> service -> D1 seam end-to-end against the test pool's
// local D1 (schema applied by ensureSchema).
const db = drizzle(env.DB);

function seedUser(id, { username, email, rating = 800 } = {}) {
	return db.insert(users).values({
		id,
		username: username ?? id,
		email: email ?? `${id}@typiks.test`,
		rating,
		createdAt: new Date(),
	});
}

async function assertRankedCacheIsHighestModeRating(userId) {
	const cached = await db.select({ rating: users.rating }).from(users).where(eq(users.id, userId)).limit(1);
	const highest = await getHighestModeRating(db, userId);
	expect(Number(cached[0].rating)).toBe(highest);
	return highest;
}

async function countRows({ table, column }) {
	const rows = await db.select({ column }).from(table);
	return rows.length;
}

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

describe('match persistence seams (real D1)', () => {
	beforeEach(async () => {
		await ensureSchema();
		await db.delete(rankedGameLogs);
		await db.delete(matchParticipants);
		await db.delete(matches);
		await db.delete(userModeStats);
		await db.delete(users);
	});

	describe('persistRankedMatchResult', () => {
		it('writes a ranked match atomically and returns ratings', async () => {
			await seedUser('alice');
			await seedUser('bob');

			const result = await persistRankedMatchResult(db, {
				gameId: 'game-r1',
				modeSeconds: 30,
				difficulty: 'medium',
				seed: 42,
				player1: { id: 'alice', score: 40, progress: 18, won: true },
				player2: { id: 'bob', score: 20, progress: 10, won: false },
				isDraw: false,
			});

			expect(result.idempotent).toBe(false);
			expect(result.ratings.player1.id).toBe('alice');
			expect(result.ratings.player1.ratingChange).toBe(20);
			expect(result.ratings.player2.id).toBe('bob');
			expect(result.ratings.player2.ratingChange).toBe(-20);

			const [match] = await db.select().from(matches).where(eq(matches.id, 'game-r1'));
			expect(match.mode).toBe('ranked');
			expect(match.modeSeconds).toBe(30);
			expect(match.difficulty).toBe('medium');
			expect(match.seed).toBe(42);
			expect(match.status).toBe(GAME_STATUS_FINISHED);
			expect(match.endedAt).toBeInstanceOf(Date);

			const participants = await db
				.select()
				.from(matchParticipants)
				.where(eq(matchParticipants.matchId, 'game-r1'))
				.orderBy(matchParticipants.userId);
			expect(participants).toHaveLength(2);
			expect(participants[0]).toMatchObject({
				matchId: 'game-r1',
				userId: 'alice',
				opponentId: 'bob',
				placement: 1,
				result: 'win',
				score: 40,
				opponentScore: 20,
				ratingBefore: 800,
				ratingAfter: 820,
			});
			expect(participants[1]).toMatchObject({
				userId: 'bob',
				placement: 2,
				result: 'loss',
				ratingBefore: 800,
				ratingAfter: 780,
			});

			const logs = await db.select().from(rankedGameLogs).where(eq(rankedGameLogs.gameId, 'game-r1'));
			expect(logs).toHaveLength(2);
			const aliceLog = logs.find((log) => log.userId === 'alice');
			expect(aliceLog).toMatchObject({ won: 1, isDraw: 0, ratingBefore: 800, ratingAfter: 820 });
			const bobLog = logs.find((log) => log.userId === 'bob');
			expect(bobLog).toMatchObject({ won: 0, ratingBefore: 800, ratingAfter: 780 });

			// ensureUserModeRows creates all ranked modes; 15/60 keep the default.
			const aliceModes = await db
				.select()
				.from(userModeStats)
				.where(eq(userModeStats.userId, 'alice'))
				.orderBy(userModeStats.modeSeconds);
			expect(aliceModes.map((row) => row.modeSeconds)).toEqual([15, 30, 60]);
			const alice30 = aliceModes.find((row) => row.modeSeconds === 30);
			expect(alice30).toMatchObject({ gamesPlayed: 1, gamesWon: 1, gamesLost: 0, totalScore: 40, rating: 820 });

			const bob30 = (
				await db
					.select()
					.from(userModeStats)
					.where(and(eq(userModeStats.userId, 'bob'), eq(userModeStats.modeSeconds, 30)))
			)[0];
			expect(bob30).toMatchObject({ gamesPlayed: 1, gamesWon: 0, gamesLost: 1, rating: 780 });

			// users.rating is the derived cache: max over mode rows. A loss does
			// not drag a user below their other (still louder) ratings.
			expect(await assertRankedCacheIsHighestModeRating('alice')).toBe(820);
			expect(await assertRankedCacheIsHighestModeRating('bob')).toBe(800);
		});

		it('is idempotent on a duplicate gameId', async () => {
			await seedUser('alice');
			await seedUser('bob');
			const input = {
				gameId: 'game-r2',
				modeSeconds: 60,
				difficulty: 'hard',
				seed: 7,
				player1: { id: 'alice', score: 50, progress: 20, won: false },
				player2: { id: 'bob', score: 55, progress: 21, won: true },
				isDraw: false,
			};

			await persistRankedMatchResult(db, input);
			const again = await persistRankedMatchResult(db, input);

			expect(again.idempotent).toBe(true);
			expect(again.ratings.player1.ratingAfter).toBe(780);
			expect(again.ratings.player2.ratingAfter).toBe(820);

			const aliceModes = await db
				.select()
				.from(userModeStats)
				.where(eq(userModeStats.userId, 'alice'))
				.orderBy(userModeStats.modeSeconds);
			expect(aliceModes.map((row) => row.modeSeconds)).toEqual([15, 30, 60]);
			expect(aliceModes.find((row) => row.modeSeconds === 15).gamesPlayed).toBe(0);
			expect(aliceModes.find((row) => row.modeSeconds === 30).gamesPlayed).toBe(0);

			expect(await countRows({ table: matches, column: matches.id })).toBe(1);
			expect(await countRows({ table: matchParticipants, column: matchParticipants.matchId })).toBe(2);
			expect(await countRows({ table: rankedGameLogs, column: rankedGameLogs.id })).toBe(2);

			const alice60 = (
				await db
					.select()
					.from(userModeStats)
					.where(and(eq(userModeStats.userId, 'alice'), eq(userModeStats.modeSeconds, 60)))
			)[0];
			expect(alice60).toMatchObject({ gamesPlayed: 1, gamesLost: 1, rating: 780 });
		});

		it('keeps users.rating equal to the highest mode rating after a subsequent match', async () => {
			// carol's 15s mode already outranks the 30s mode she plays now.
			await db.insert(users).values([
				{ id: 'carol', username: 'carol', email: 'carol@typiks.test', rating: 950, createdAt: new Date() },
				{ id: 'dave', username: 'dave', email: 'dave@typiks.test', rating: 900, createdAt: new Date() },
			]);
			await db.insert(userModeStats).values([
				{ userId: 'carol', modeSeconds: 15, rating: 950, updatedAt: new Date() },
				{ userId: 'carol', modeSeconds: 30, rating: 900, updatedAt: new Date() },
				{ userId: 'carol', modeSeconds: 60, rating: 800, updatedAt: new Date() },
				{ userId: 'dave', modeSeconds: 15, rating: 900, updatedAt: new Date() },
				{ userId: 'dave', modeSeconds: 30, rating: 900, updatedAt: new Date() },
				{ userId: 'dave', modeSeconds: 60, rating: 800, updatedAt: new Date() },
			]);

			// carol loses the 30s match, but her 15s rating (950) must still own the cache.
			await persistRankedMatchResult(db, {
				gameId: 'game-r3',
				modeSeconds: 30,
				difficulty: 'medium',
				seed: 1,
				player1: { id: 'carol', score: 10, progress: 5, won: false },
				player2: { id: 'dave', score: 30, progress: 15, won: true },
				isDraw: false,
			});

			expect((await db.select().from(users).where(eq(users.id, 'carol')))[0].rating).toBe(950);
			expect((await db.select().from(users).where(eq(users.id, 'dave')))[0].rating).toBe(920);
			await assertRankedCacheIsHighestModeRating('carol');
			await assertRankedCacheIsHighestModeRating('dave');
		});
	});

	describe('persistRoomMatchResult', () => {
		it('writes an unrated ffa match with all participants and is idempotent', async () => {
			await seedUser('p1');
			await seedUser('p2');
			await seedUser('p3');

			const first = await persistRoomMatchResult(db, {
				gameId: 'game-room1',
				roomCode: 'AB12CD',
				mode: 'ffa',
				modeSeconds: 30,
				difficulty: 'easy',
				seed: 9,
				players: [
					{ id: 'p1', score: 30, progress: 15, correctChars: 90, placement: 1 },
					{ id: 'p2', score: 20, progress: 10, correctChars: 60, placement: 2 },
					{ id: 'p3', score: 10, progress: 5, correctChars: 30, placement: 3 },
				],
				winnerId: 'p1',
				isDraw: false,
			});

			expect(first.idempotent).toBe(false);
			const [match] = await db.select().from(matches).where(eq(matches.id, 'game-room1'));
			expect(match).toMatchObject({
				roomCode: 'AB12CD',
				mode: 'ffa',
				modeSeconds: 30,
				status: GAME_STATUS_FINISHED,
			});

			const participants = await db
				.select()
				.from(matchParticipants)
				.where(eq(matchParticipants.matchId, 'game-room1'))
				.orderBy(matchParticipants.placement);
			expect(participants).toHaveLength(3);
			expect(participants[0]).toMatchObject({ userId: 'p1', placement: 1, result: 'win', ratingBefore: null });
			expect(participants[1]).toMatchObject({ userId: 'p2', placement: 2, result: 'loss' });
			expect(participants[2]).toMatchObject({ userId: 'p3', placement: 3, result: 'loss' });

			const again = await persistRoomMatchResult(db, {
				gameId: 'game-room1',
				roomCode: 'AB12CD',
				mode: 'ffa',
				modeSeconds: 30,
				difficulty: 'easy',
				seed: 9,
				players: [
					{ id: 'p1', score: 30, progress: 15, correctChars: 90, placement: 1 },
					{ id: 'p2', score: 20, progress: 10, correctChars: 60, placement: 2 },
					{ id: 'p3', score: 10, progress: 5, correctChars: 30, placement: 3 },
				],
				winnerId: 'p1',
				isDraw: false,
			});
			expect(again.idempotent).toBe(true);
			expect(await countRows({ table: matches, column: matches.id })).toBe(1);
			expect(await countRows({ table: matchParticipants, column: matchParticipants.matchId })).toBe(3);
		});
	});

	describe('GameRoom.endGame -> persistRankedMatchResult', () => {
		it('writes the ranked match when the DO holds a DB binding', async () => {
			await seedUser('mia');
			await seedUser('noah');

			const room = new GameRoom({}, { FIREBASE_PROJECT_ID: 'typiks', DB: env.DB });
			const game = {
				id: 'game-d1',
				difficulty: 'medium',
				seed: 12,
				modeSeconds: 30,
				startTime: Date.now(),
				status: 'playing',
				player1: {
					id: 'mia',
					sessionId: 'session-mia',
					userInfo: { username: 'mia', rating: 800 },
					score: 8,
					currentWordIndex: 8,
				},
				player2: {
					id: 'noah',
					sessionId: 'session-noah',
					userInfo: { username: 'noah', rating: 800 },
					score: 4,
					currentWordIndex: 4,
				},
				words: ['alpha', 'bravo'],
			};
			room.activeGames.set('game-d1', game);
			room.playerToGame.set('mia', 'game-d1');
			room.playerToGame.set('noah', 'game-d1');
			room.sessions.set('session-mia', createSocket());
			room.sessions.set('session-noah', createSocket());

			await room.endGame('game-d1', 'completed');

			const [match] = await db.select().from(matches).where(eq(matches.id, 'game-d1'));
			expect(match).toMatchObject({
				mode: 'ranked',
				modeSeconds: 30,
				seed: 12,
				status: GAME_STATUS_FINISHED,
			});

			const participants = await db
				.select()
				.from(matchParticipants)
				.where(eq(matchParticipants.matchId, 'game-d1'))
				.orderBy(matchParticipants.userId);
			expect(participants).toHaveLength(2);
			expect(participants[0]).toMatchObject({ userId: 'mia', result: 'win', score: 8, opponentScore: 4 });
			expect(participants[1]).toMatchObject({ userId: 'noah', result: 'loss' });

			expect(room.lastResults.ratings.player1.id).toBe('mia');
			expect(room.lastResults.ratings.player1.ratingChange).toBe(20);
			expect(room.activeGames.has('game-d1')).toBe(false);

			await assertRankedCacheIsHighestModeRating('mia');
			await assertRankedCacheIsHighestModeRating('noah');
		});
	});

	describe('foreign keys (migration 0010)', () => {
		async function foreignKeysFor(table) {
			const { results } = await env.DB.prepare(
				`select "table", "from", "to" from pragma_foreign_key_list('${table}')`
			).all();
			return results.map((row) => ({ from: row.from, to: row.to, table: row.table }));
		}

		it('declares the normalized-model foreign keys', async () => {
			const pk = await foreignKeysFor('match_participants');
			expect(pk).toContainEqual({ from: 'match_id', to: 'id', table: 'matches' });
			expect(pk).toContainEqual({ from: 'user_id', to: 'id', table: 'users' });
			expect(pk).toContainEqual({ from: 'opponent_id', to: 'id', table: 'users' });

			const us = await foreignKeysFor('user_settings');
			expect(us).toContainEqual({ from: 'user_id', to: 'id', table: 'users' });

			const rm = await foreignKeysFor('rooms');
			expect(rm).toContainEqual({ from: 'owner_id', to: 'id', table: 'users' });

			const members = await foreignKeysFor('room_members');
			expect(members).toContainEqual({ from: 'room_code', to: 'room_code', table: 'rooms' });
			expect(members).toContainEqual({ from: 'user_id', to: 'id', table: 'users' });
		});

		it('enforces the match_participants -> matches foreign key', async () => {
			await seedUser('carol');

			await expect(
				db.insert(matchParticipants).values({
					matchId: 'no-such-match',
					userId: 'carol',
					score: 0,
					opponentScore: 0,
					progress: 0,
					correctChars: 0,
					createdAt: new Date(),
				})
			).rejects.toThrow(/insert into "match_participants"/i);
		});
	});
});