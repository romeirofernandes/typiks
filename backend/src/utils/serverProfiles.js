import { drizzle } from 'drizzle-orm/d1';
import { inArray } from 'drizzle-orm';
import { users } from '../db/schema.js';

// Neutral fallback used when a player is not found in D1 or the database
// cannot be queried. NOTE: this deliberately does NOT fall back to any
// client-asserted userInfo — clients never decide what opponents see.
const NEUTRAL_PROFILE = { username: 'player', rating: 800 };

function normalizeProfile(profile) {
	const safe = { ...NEUTRAL_PROFILE };
	if (!profile || typeof profile !== 'object') return safe;

	if (typeof profile.username === 'string' && profile.username.trim().length > 0) {
		safe.username = profile.username.trim().slice(0, 32);
	}

	const parsedRating = Number(profile.rating);
	if (Number.isFinite(parsedRating)) {
		safe.rating = Math.max(0, Math.min(3000, Math.floor(parsedRating)));
	}

	return safe;
}

// Resolves authoritative player profiles from the D1 `users` table.
// Returns a map of playerId -> { username, rating }. Unknown
// players (or a DB failure) resolve to neutral defaults, never to client
// supplied values.
export async function resolveServerProfiles(env, playerIds) {
	const ids = Array.from(new Set(playerIds.map((id) => String(id))));
	const map = Object.create(null);
	for (const id of ids) {
		map[id] = { ...NEUTRAL_PROFILE };
	}

	if (!ids.length || !env?.DB) {
		return map;
	}

	try {
		const db = drizzle(env.DB);
		const rows = await db
			.select({
				id: users.id,
				username: users.username,
				rating: users.rating,
			})
			.from(users)
			.where(inArray(users.id, ids));

		for (const row of rows) {
			if (!row || !map[row.id]) continue;
			map[row.id] = normalizeProfile(row);
		}
	} catch (error) {
		console.error('Failed to resolve server profiles from D1:', error);
	}

	return map;
}
