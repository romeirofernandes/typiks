import { and, eq } from 'drizzle-orm';
import {
    matchParticipants,
    matches,
    rankedGameLogs,
    userModeStats,
    users,
} from '../db/schema.js';
import { calculateNewRatings } from '../utils/rating.js';
import { ensureUserModeRows } from './user-stats.js';
import { generateEntityId } from './ids.js';
import { DEFAULT_RATING, GAME_STATUS_FINISHED } from '../config.js';

// Pure rating computation shared by ranked persistence + tests.
export function computeRankedOutcome(playerModeStats, opponentModeStats, { playerWon, isDraw }) {
    const playerResult = isDraw ? 0.5 : playerWon ? 1 : 0;
    const opponentResult = isDraw ? 0.5 : playerWon ? 0 : 1;

    const playerRating = calculateNewRatings(
        playerModeStats.rating,
        opponentModeStats.rating,
        playerResult,
        { gamesPlayed: playerModeStats.gamesPlayed }
    );
    const opponentRating = calculateNewRatings(
        opponentModeStats.rating,
        playerModeStats.rating,
        opponentResult,
        { gamesPlayed: opponentModeStats.gamesPlayed }
    );

    return {
        playerRating,
        opponentRating,
        playerRatingChange: playerRating - playerModeStats.rating,
        opponentRatingChange: opponentRating - opponentModeStats.rating,
    };
}

function matchRatingsDto(ratings, player1Id, player2Id) {
    return {
        player1: {
            id: player1Id,
            ratingBefore: ratings.player1.ratingBefore,
            ratingAfter: ratings.player1.ratingAfter,
            ratingChange: ratings.player1.ratingChange,
        },
        player2: {
            id: player2Id,
            ratingBefore: ratings.player2.ratingBefore,
            ratingAfter: ratings.player2.ratingAfter,
            ratingChange: ratings.player2.ratingChange,
        },
    };
}

export async function readMatchRatings(db, gameId, player1Id, player2Id) {
    const rows = await db
        .select()
        .from(rankedGameLogs)
        .where(
            and(eq(rankedGameLogs.gameId, gameId), eq(rankedGameLogs.userId, player1Id))
        )
        .limit(1);

    if (rows.length === 0) {
        return null;
    }

    const logsForBoth = await db
        .select()
        .from(rankedGameLogs)
        .where(
            and(eq(rankedGameLogs.gameId, gameId), eq(rankedGameLogs.userId, player2Id))
        )
        .limit(1);

    if (logsForBoth.length === 0) {
        return null;
    }

    const player1 = rows[0];
    const player2 = logsForBoth[0];

    return {
        player1: {
            id: player1Id,
            ratingBefore: player1.ratingBefore,
            ratingAfter: player1.ratingAfter,
            ratingChange: player1.ratingAfter - player1.ratingBefore,
        },
        player2: {
            id: player2Id,
            ratingBefore: player2.ratingBefore,
            ratingAfter: player2.ratingAfter,
            ratingChange: player2.ratingAfter - player2.ratingBefore,
        },
    };
}

// Server-authoritative ranked result writer. Called from GameRoom.endGame.
// Idempotent on gameId, so a recovered/duplicated finalize cannot double-count.
// All writes run in a single D1 batch (atomic).
export async function persistRankedMatchResult(db, input) {
    const {
        gameId,
        modeSeconds,
        roomCode = null,
        difficulty,
        seed,
        startedAt = null,
        endedAt = new Date(),
        player1, // { id, score, progress, won }
        player2, // { id, score, progress, won }
        isDraw,
        disconnectedPlayerId = null,
    } = input;

    // Idempotency guard: this match was already recorded.
    const [existingMatch] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(eq(matches.id, gameId))
        .limit(1);

    if (existingMatch) {
        const ratings = await readMatchRatings(db, gameId, player1.id, player2.id);
        return { idempotent: true, ratings };
    }

    // Load both players + their mode rows for rating math.
    const [playerRow, opponentRow] = await Promise.all([
        db.select().from(users).where(eq(users.id, player1.id)).limit(1),
        db.select().from(users).where(eq(users.id, player2.id)).limit(1),
    ]);

    if (playerRow.length === 0 || opponentRow.length === 0) {
        throw new Error(`Cannot persist ranked result for missing users: ${gameId}`);
    }

    await Promise.all([ensureUserModeRows(db, player1.id), ensureUserModeRows(db, player2.id)]);

    const [playerModeRows, opponentModeRows] = await Promise.all([
        db
            .select()
            .from(userModeStats)
            .where(and(eq(userModeStats.userId, player1.id), eq(userModeStats.modeSeconds, modeSeconds)))
            .limit(1),
        db
            .select()
            .from(userModeStats)
            .where(and(eq(userModeStats.userId, player2.id), eq(userModeStats.modeSeconds, modeSeconds)))
            .limit(1),
    ]);

    const playerModeStats = playerModeRows[0];
    const opponentModeStats = opponentModeRows[0];

    if (!playerModeStats || !opponentModeStats) {
        throw new Error(`Failed to initialize mode stats for match ${gameId}`);
    }

    const { playerRating, opponentRating } = computeRankedOutcome(
        playerModeStats,
        opponentModeStats,
        { playerWon: Boolean(player1.won), isDraw }
    );

    const now = new Date();
    const playerPlacement = isDraw ? 1 : Boolean(player1.won) ? 1 : 2;
    const opponentPlacement = isDraw ? 1 : Boolean(player2.won) ? 1 : 2;

    const nextPlayerRating = Math.max(Number(playerRow[0].rating ?? DEFAULT_RATING), playerRating);
    const nextOpponentRating = Math.max(Number(opponentRow[0].rating ?? DEFAULT_RATING), opponentRating);

    await db.batch([
        db.insert(matches).values({
            id: gameId,
            roomCode,
            mode: 'ranked',
            modeSeconds,
            difficulty,
            seed,
            status: GAME_STATUS_FINISHED,
            startedAt,
            endedAt,
            createdAt: now,
        }),
        db.insert(matchParticipants).values([
            {
                matchId: gameId,
                userId: player1.id,
                opponentId: player2.id,
                placement: playerPlacement,
                result: isDraw ? 'draw' : Boolean(player1.won) ? 'win' : 'loss',
                score: player1.score,
                opponentScore: player2.score,
                progress: player1.progress,
                correctChars: 0,
                disconnected: disconnectedPlayerId === player1.id ? 1 : 0,
                ratingBefore: playerModeStats.rating,
                ratingAfter: playerRating,
                createdAt: now,
            },
            {
                matchId: gameId,
                userId: player2.id,
                opponentId: player1.id,
                placement: opponentPlacement,
                result: isDraw ? 'draw' : Boolean(player2.won) ? 'win' : 'loss',
                score: player2.score,
                opponentScore: player1.score,
                progress: player2.progress,
                correctChars: 0,
                disconnected: disconnectedPlayerId === player2.id ? 1 : 0,
                ratingBefore: opponentModeStats.rating,
                ratingAfter: opponentRating,
                createdAt: now,
            },
        ]),
        db.insert(rankedGameLogs).values([
            {
                id: generateEntityId('match'),
                gameId,
                userId: player1.id,
                opponentId: player2.id,
                modeSeconds,
                score: player1.score,
                opponentScore: player2.score,
                won: isDraw ? 0 : Boolean(player1.won) ? 1 : 0,
                isDraw: isDraw ? 1 : 0,
                ratingBefore: playerModeStats.rating,
                ratingAfter: playerRating,
                createdAt: now,
            },
            {
                id: generateEntityId('match'),
                gameId,
                userId: player2.id,
                opponentId: player1.id,
                modeSeconds,
                score: player2.score,
                opponentScore: player1.score,
                won: isDraw ? 0 : Boolean(player2.won) ? 1 : 0,
                isDraw: isDraw ? 1 : 0,
                ratingBefore: opponentModeStats.rating,
                ratingAfter: opponentRating,
                createdAt: now,
            },
        ]),
        db
            .update(userModeStats)
            .set({
                gamesPlayed: Number(playerModeStats.gamesPlayed) + 1,
                gamesWon: !isDraw && Boolean(player1.won) ? Number(playerModeStats.gamesWon) + 1 : playerModeStats.gamesWon,
                gamesLost: !isDraw && !Boolean(player1.won) ? Number(playerModeStats.gamesLost) + 1 : playerModeStats.gamesLost,
                gamesDrawn: isDraw ? Number(playerModeStats.gamesDrawn) + 1 : playerModeStats.gamesDrawn,
                totalScore: Number(playerModeStats.totalScore) + player1.score,
                rating: playerRating,
                updatedAt: now,
            })
            .where(and(eq(userModeStats.userId, player1.id), eq(userModeStats.modeSeconds, modeSeconds))),
        db
            .update(userModeStats)
            .set({
                gamesPlayed: Number(opponentModeStats.gamesPlayed) + 1,
                gamesWon: !isDraw && Boolean(player2.won) ? Number(opponentModeStats.gamesWon) + 1 : opponentModeStats.gamesWon,
                gamesLost: !isDraw && !Boolean(player2.won) ? Number(opponentModeStats.gamesLost) + 1 : opponentModeStats.gamesLost,
                gamesDrawn: isDraw ? Number(opponentModeStats.gamesDrawn) + 1 : opponentModeStats.gamesDrawn,
                totalScore: Number(opponentModeStats.totalScore) + player2.score,
                rating: opponentRating,
                updatedAt: now,
            })
            .where(and(eq(userModeStats.userId, player2.id), eq(userModeStats.modeSeconds, modeSeconds))),
        db
            .update(users)
            .set({
                gamesPlayed: Number(playerRow[0].gamesPlayed) + 1,
                gamesWon: !isDraw && Boolean(player1.won) ? Number(playerRow[0].gamesWon) + 1 : playerRow[0].gamesWon,
                gamesLost: !isDraw && !Boolean(player1.won) ? Number(playerRow[0].gamesLost) + 1 : playerRow[0].gamesLost,
                rating: nextPlayerRating,
            })
            .where(eq(users.id, player1.id)),
        db
            .update(users)
            .set({
                gamesPlayed: Number(opponentRow[0].gamesPlayed) + 1,
                gamesWon: !isDraw && Boolean(player2.won) ? Number(opponentRow[0].gamesWon) + 1 : opponentRow[0].gamesWon,
                gamesLost: !isDraw && !Boolean(player2.won) ? Number(opponentRow[0].gamesLost) + 1 : opponentRow[0].gamesLost,
                rating: nextOpponentRating,
            })
            .where(eq(users.id, player2.id)),
    ]);

    const ratings = matchRatingsDto(
        {
            player1: {
                ratingBefore: playerModeStats.rating,
                ratingAfter: playerRating,
                ratingChange: playerRating - playerModeStats.rating,
            },
            player2: {
                ratingBefore: opponentModeStats.rating,
                ratingAfter: opponentRating,
                ratingChange: opponentRating - opponentModeStats.rating,
            },
        },
        player1.id,
        player2.id
    );

    return { idempotent: false, ratings };
}

// Server-authoritative room-match result writer. Called from PrivateRoom.endGame.
// Not rated; idempotent on gameId.
export async function persistRoomMatchResult(db, input) {
    const {
        gameId,
        roomCode,
        mode, // 'ffa' | 'coop'
        modeSeconds,
        difficulty,
        seed,
        startedAt = null,
        endedAt = new Date(),
        players, // [{ id, score, progress, correctChars, placement }]
        winnerId,
        isDraw,
    } = input;

    const [existingMatch] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(eq(matches.id, gameId))
        .limit(1);

    if (existingMatch) {
        return { idempotent: true };
    }

    const now = new Date();

    await db.batch([
        db.insert(matches).values({
            id: gameId,
            roomCode,
            mode,
            modeSeconds,
            difficulty,
            seed,
            status: GAME_STATUS_FINISHED,
            startedAt,
            endedAt,
            createdAt: now,
        }),
        db.insert(matchParticipants).values(
            players.map((player) => ({
                matchId: gameId,
                userId: player.id,
                opponentId: null,
                placement: player.placement,
                result: isDraw ? 'draw' : winnerId ? (player.id === winnerId ? 'win' : 'loss') : null,
                score: player.score,
                opponentScore: 0,
                progress: player.progress,
                correctChars: player.correctChars,
                ratingBefore: null,
                ratingAfter: null,
                createdAt: now,
            }))
        ),
    ]);

    return { idempotent: false };
}

export { matchRatingsDto };