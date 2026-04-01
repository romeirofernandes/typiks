import {
	sqliteTable,
	text,
	integer,
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
