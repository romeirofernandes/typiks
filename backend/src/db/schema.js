import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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
