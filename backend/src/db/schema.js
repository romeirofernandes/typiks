import {
    sqliteTable,
    text,
    integer,
    real,
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

export const matches = sqliteTable(
    'matches',
    {
        id: text('id').primaryKey(),
        roomCode: text('room_code'),
        mode: text('mode').notNull(), // 'ranked' | 'ffa' | 'coop'
        modeSeconds: integer('mode_seconds').notNull(),
        difficulty: text('difficulty').notNull(),
        seed: integer('seed').notNull(),
        status: text('status').notNull(),
        startedAt: integer('started_at', { mode: 'timestamp' }),
        endedAt: integer('ended_at', { mode: 'timestamp' }),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    },
    (table) => ({
        roomCodeIdx: index('matches_room_code_idx').on(table.roomCode),
        createdAtIdx: index('matches_created_at_idx').on(table.createdAt),
        statusIdx: index('matches_status_idx').on(table.status),
    })
);

export const matchParticipants = sqliteTable(
    'match_participants',
    {
        matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        opponentId: text('opponent_id').references(() => users.id, { onDelete: 'set null' }),
        placement: integer('placement').notNull().default(0),
        result: text('result'), // 'win' | 'loss' | 'draw', null for team modes
        score: integer('score').notNull().default(0),
        opponentScore: integer('opponent_score').notNull().default(0),
        progress: integer('progress').notNull().default(0),
        correctChars: integer('correct_chars').notNull().default(0),
        wpm: real('wpm'),
        accuracy: real('accuracy'),
        disconnected: integer('disconnected').notNull().default(0),
        ratingBefore: integer('rating_before'),
        ratingAfter: integer('rating_after'),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.matchId, table.userId] }),
        matchIdx: index('match_participants_match_id_idx').on(table.matchId),
        userIdx: index('match_participants_user_id_idx').on(table.userId),
        userDateIdx: index('match_participants_user_date_idx').on(table.userId, table.createdAt),
    })
);

export const userSettings = sqliteTable(
    'user_settings',
    {
        userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
        regionAnalyticsConsent: integer('region_analytics_consent').notNull().default(0),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
        updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    }
);

export const rooms = sqliteTable(
    'rooms',
    {
        roomCode: text('room_code').primaryKey(),
        ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        name: text('name').notNull().default(''),
        visibility: text('visibility').notNull().default('private'),
        status: text('status').notNull().default('open'),
        maxPlayers: integer('max_players').notNull().default(6),
        modeSeconds: integer('mode_seconds'),
        wordCount: integer('word_count'),
        createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
        closedAt: integer('closed_at', { mode: 'timestamp' }),
    },
    (table) => ({
        ownerIdx: index('rooms_owner_id_idx').on(table.ownerId),
    })
);

export const roomMembers = sqliteTable(
    'room_members',
    {
        roomCode: text('room_code').notNull().references(() => rooms.roomCode, { onDelete: 'cascade' }),
        userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        role: text('role').notNull().default('member'),
        joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull(),
        leftAt: integer('left_at', { mode: 'timestamp' }),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.roomCode, table.userId] }),
        userIdx: index('room_members_user_id_idx').on(table.userId),
    })
);
