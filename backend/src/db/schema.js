import {
    sqliteTable,
    text,
    integer,
    index,
    uniqueIndex,
    primaryKey,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
    id: text('id').primaryKey(), // Firebase UID
    username: text('username').notNull().unique(),
    email: text('email').notNull().unique(),
    country: text('country'),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
    gamesPlayed: integer('games_played').default(0),
    gamesWon: integer('games_won').default(0),
    gamesLost: integer('games_lost').default(0),
    rating: integer('rating').default(800),
    nextWordCondition: text('next_word_condition').notNull().default('auto'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const friendRequests = sqliteTable(
    'friend_requests',
    {
        id: text('id').primaryKey(),
        senderId: text('sender_id').notNull(),
        receiverId: text('receiver_id').notNull(),
        status: text('status').notNull().default('pending'),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
        respondedAt: integer('responded_at', { mode: 'timestamp' }),
    },
    (table) => ({
        senderIdx: index('friend_requests_sender_id_idx').on(table.senderId),
        receiverStatusIdx: index('friend_requests_receiver_status_idx').on(table.receiverId, table.status),
        senderReceiverIdx: index('friend_requests_sender_receiver_idx').on(table.senderId, table.receiverId),
        senderReceiverUnique: uniqueIndex('friend_requests_sender_receiver_unique').on(table.senderId, table.receiverId),
    })
);

export const friendships = sqliteTable(
    'friendships',
    {
        userA: text('user_a').notNull(),
        userB: text('user_b').notNull(),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userA, table.userB] }),
        userAIdx: index('friendships_user_a_idx').on(table.userA),
        userBIdx: index('friendships_user_b_idx').on(table.userB),
    })
);

export const roomInvites = sqliteTable(
    'room_invites',
    {
        id: text('id').primaryKey(),
        roomCode: text('room_code').notNull(),
        inviterId: text('inviter_id').notNull(),
        inviteeId: text('invitee_id').notNull(),
        status: text('status').notNull().default('pending'),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
        respondedAt: integer('responded_at', { mode: 'timestamp' }),
    },
    (table) => ({
        inviteeStatusIdx: index('room_invites_invitee_status_idx').on(table.inviteeId, table.status),
        roomCodeIdx: index('room_invites_room_code_idx').on(table.roomCode),
        inviterIdx: index('room_invites_inviter_id_idx').on(table.inviterId),
        uniquePendingInvite: uniqueIndex('room_invites_unique_pending').on(
            table.roomCode,
            table.inviterId,
            table.inviteeId,
            table.status
        ),
    })
);

export const userModeStats = sqliteTable(
    'user_mode_stats',
    {
        userId: text('user_id').notNull(),
        modeSeconds: integer('mode_seconds').notNull(),
        gamesPlayed: integer('games_played').notNull().default(0),
        gamesWon: integer('games_won').notNull().default(0),
        gamesLost: integer('games_lost').notNull().default(0),
        gamesDrawn: integer('games_drawn').notNull().default(0),
        totalScore: integer('total_score').notNull().default(0),
        rating: integer('rating').notNull().default(800),
        updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.userId, table.modeSeconds] }),
        userIdx: index('user_mode_stats_user_id_idx').on(table.userId),
        modeIdx: index('user_mode_stats_mode_seconds_idx').on(table.modeSeconds),
    })
);

export const games = sqliteTable(
    'games',
    {
        id: text('id').primaryKey(),
        modeSeconds: integer('mode_seconds').notNull(),
        difficulty: text('difficulty').notNull(),
        seed: integer('seed').notNull(),
        status: text('status').notNull(),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
        finishedAt: integer('finished_at', { mode: 'timestamp' }),
    },
    (table) => ({
        statusIdx: index('games_status_idx').on(table.status),
        createdAtIdx: index('games_created_at_idx').on(table.createdAt),
    })
);

export const rankedGameLogs = sqliteTable(
    'ranked_game_logs',
    {
        id: text('id').primaryKey(),
        gameId: text('game_id').notNull(),
        userId: text('user_id').notNull(),
        opponentId: text('opponent_id').notNull(),
        modeSeconds: integer('mode_seconds').notNull(),
        score: integer('score').notNull(),
        opponentScore: integer('opponent_score').notNull(),
        won: integer('won').notNull().default(0),
        isDraw: integer('is_draw').notNull().default(0),
        ratingBefore: integer('rating_before').notNull(),
        ratingAfter: integer('rating_after').notNull(),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    },
    (table) => ({
        gameUserUnique: uniqueIndex('ranked_game_logs_game_user_unique').on(table.gameId, table.userId),
        userDateIdx: index('ranked_game_logs_user_date_idx').on(table.userId, table.createdAt),
        userModeIdx: index('ranked_game_logs_user_mode_idx').on(table.userId, table.modeSeconds),
        modeIdx: index('ranked_game_logs_mode_seconds_idx').on(table.modeSeconds),
    })
);
