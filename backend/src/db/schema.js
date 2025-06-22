import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), 
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  gamesPlayed: integer('games_played').default(0),
  gamesWon: integer('games_won').default(0),
  gamesLost: integer('games_lost').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});