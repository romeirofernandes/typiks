import {
	sqliteTable,
	text,
	integer,
	real,
	index,
	primaryKey,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(), // Firebase UID
	username: text('username').notNull().unique(),
	email: text('email').notNull().unique(),
	gamesPlayed: integer('games_played').default(0),
	gamesWon: integer('games_won').default(0),
	gamesLost: integer('games_lost').default(0),
	rating: integer('rating').default(800), 
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
	})
);

export const friendships = sqliteTable(
	'friendships',
	{
		userId: text('user_id').notNull(),
		friendId: text('friend_id').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.friendId] }),
		userIdx: index('friendships_user_id_idx').on(table.userId),
		friendIdx: index('friendships_friend_id_idx').on(table.friendId),
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
		averageScore: real('average_score').notNull().default(0),
		rating: integer('rating').notNull().default(800),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.modeSeconds] }),
		userIdx: index('user_mode_stats_user_id_idx').on(table.userId),
		modeIdx: index('user_mode_stats_mode_seconds_idx').on(table.modeSeconds),
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
		gameUserIdx: index('ranked_game_logs_game_user_idx').on(table.gameId, table.userId),
		userDateIdx: index('ranked_game_logs_user_date_idx').on(table.userId, table.createdAt),
		modeIdx: index('ranked_game_logs_mode_seconds_idx').on(table.modeSeconds),
	})
);
