import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	friendships,
	friendRequests,
	games,
	rankedGameLogs,
	roomInvites,
	userModeStats,
	users,
} from '../db/schema.js';
import { calculateNewRatings } from '../utils/rating.js';
import { requireFirebaseAuth } from '../middleware/firebaseAuth.js';

const userRouter = new Hono();

const requireAuth = requireFirebaseAuth();

const FRIEND_REQUEST_PENDING = 'pending';
const FRIEND_REQUEST_ACCEPTED = 'accepted';
const FRIEND_REQUEST_REJECTED = 'rejected';
const ROOM_INVITE_PENDING = 'pending';
const ROOM_INVITE_ACCEPTED = 'accepted';
const ROOM_INVITE_REJECTED = 'rejected';
const RANKED_MODE_SECONDS = [15, 30, 60, 120];
const DEFAULT_RATING = 800;
const GAME_STATUS_FINISHED = 'finished';
const ONLINE_WINDOW_MS = 60 * 1000;
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const locationCache = {
	countries: {
		data: null,
		expiresAt: 0,
	},
	citiesByCountry: new Map(),
	cityGeocodes: new Map(),
};

function normalizeLocationKey(value) {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : null;
}

function generateEntityId(prefix) {
	if (typeof crypto?.randomUUID === 'function') {
		return `${prefix}_${crypto.randomUUID()}`;
	}

	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUsername(value) {
	if (typeof value !== 'string') return null;
	const username = value.trim().toLowerCase();
	if (username.length < 3 || username.length > 24) return null;
	if (!/^[a-z0-9._-]+$/.test(username)) return null;
	return username;
}

function normalizeModeSeconds(rawValue) {
	const parsed = Number.parseInt(String(rawValue), 10);
	if (!Number.isFinite(parsed) || !RANKED_MODE_SECONDS.includes(parsed)) {
		return 60;
	}

	return parsed;
}

function normalizeOptionalLocationValue(value, maxLength = 80) {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().slice(0, maxLength);
	return normalized.length > 0 ? normalized : null;
}

function normalizeRoomCode(value) {
	if (typeof value !== 'string') return null;
	const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	return code.length === 6 ? code : null;
}

function isRecentlyOnline(lastSeenAt) {
	if (!lastSeenAt) return false;
	const value = new Date(lastSeenAt).getTime();
	if (!Number.isFinite(value)) return false;
	return Date.now() - value <= ONLINE_WINDOW_MS;
}

async function buildOnlineMap(db, userIds) {
	const ids = Array.from(new Set((userIds || []).filter(Boolean)));
	if (ids.length === 0) return new Map();

	return buildOnlineMapFromLastSeen(db, ids);
}

async function buildOnlineMapFromLastSeen(db, ids) {

	const rows = await db
		.select({ id: users.id, lastSeenAt: users.lastSeenAt })
		.from(users)
		.where(inArray(users.id, ids));

	const map = new Map();
	for (const row of rows) {
		map.set(row.id, isRecentlyOnline(row.lastSeenAt));
	}

	for (const id of ids) {
		if (!map.has(id)) {
			map.set(id, false);
		}
	}

	return map;
}

async function buildOnlineMapFromPresenceHub(env, userIds) {
	if (!env?.PRESENCE_HUB) return null;

	const ids = Array.from(new Set((userIds || []).filter(Boolean)));
	if (ids.length === 0) return new Map();

	try {
		const id = env.PRESENCE_HUB.idFromName('global-presence-hub');
		const hub = env.PRESENCE_HUB.get(id);
		const response = await hub.fetch('https://presence.internal/online', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ userIds: ids }),
		});

		if (!response.ok) {
			return null;
		}

		const payload = await response.json().catch(() => ({}));
		const onlineMap = payload?.onlineMap && typeof payload.onlineMap === 'object'
			? payload.onlineMap
			: {};

		const map = new Map();
		for (const uid of ids) {
			map.set(uid, Boolean(onlineMap[uid]));
		}
		return map;
	} catch (error) {
		console.error('Presence hub lookup failed:', error);
		return null;
	}
}

async function buildOnlineMapWithPresence(env, db, userIds) {
	const presenceMap = await buildOnlineMapFromPresenceHub(env, userIds);
	if (presenceMap) return presenceMap;
	return buildOnlineMap(db, userIds);
}

async function fetchLocationCountries() {
	const now = Date.now();
	if (
		Array.isArray(locationCache.countries.data) &&
		locationCache.countries.expiresAt > now
	) {
		return locationCache.countries.data;
	}

	const response = await fetch('https://restcountries.com/v3.1/all?fields=name');
	if (!response.ok) {
		throw new Error(`Countries API returned ${response.status}`);
	}

	const payload = await response.json();
	const countries = Array.isArray(payload)
		? payload
				.map((country) => country?.name?.common)
				.filter((value) => typeof value === 'string' && value.trim().length > 0)
				.map((value) => value.trim())
				.sort((a, b) => a.localeCompare(b))
		: [];

	locationCache.countries = {
		data: countries,
		expiresAt: now + LOCATION_CACHE_TTL_MS,
	};

	return countries;
}

async function fetchCitiesByCountry(country) {
	const key = country.toLowerCase();
	const now = Date.now();
	const cached = locationCache.citiesByCountry.get(key);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}

	const response = await fetch('https://countriesnow.space/api/v0.1/countries/cities', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ country }),
	});

	if (!response.ok) {
		throw new Error(`Cities API returned ${response.status}`);
	}

	const payload = await response.json();
	const cities = Array.isArray(payload?.data)
		? payload.data
				.filter((city) => typeof city === 'string' && city.trim().length > 0)
				.map((city) => city.trim())
				.sort((a, b) => a.localeCompare(b))
		: [];

	locationCache.citiesByCountry.set(key, {
		data: cities,
		expiresAt: now + LOCATION_CACHE_TTL_MS,
	});

	return cities;
}

async function fetchCityCoordinates(country, city) {
	const normalizedCountry = normalizeLocationKey(country);
	const normalizedCity = normalizeLocationKey(city);

	if (!normalizedCountry || !normalizedCity) {
		return null;
	}

	const cacheKey = `${normalizedCountry}::${normalizedCity}`;
	const now = Date.now();
	const cached = locationCache.cityGeocodes.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}

	const params = new URLSearchParams({
		city,
		country,
		format: 'jsonv2',
		limit: '1',
	});
	const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
		headers: {
			'User-Agent': 'typiks/1.0',
		},
	});

	if (!response.ok) {
		throw new Error(`Geocoding API returned ${response.status}`);
	}

	const payload = await response.json();
	const first = Array.isArray(payload) ? payload[0] : null;
	const lat = Number.parseFloat(first?.lat);
	const lng = Number.parseFloat(first?.lon);
	const data = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

	locationCache.cityGeocodes.set(cacheKey, {
		data,
		expiresAt: now + LOCATION_CACHE_TTL_MS,
	});

	return data;
}

function modeStatsRowToDto(row) {
	const gamesPlayed = Number(row.gamesPlayed || 0);
	const totalScore = Number(row.totalScore || 0);
	const averageScore = gamesPlayed > 0 ? totalScore / gamesPlayed : 0;

	return {
		modeSeconds: row.modeSeconds,
		gamesPlayed,
		gamesWon: row.gamesWon,
		gamesLost: row.gamesLost,
		gamesDrawn: row.gamesDrawn,
		totalScore,
		averageScore,
		rating: row.rating,
	};
}

function resolveFriendshipPair(userOne, userTwo) {
	if (!userOne || !userTwo || userOne === userTwo) {
		return null;
	}

	return userOne < userTwo
		? { userA: userOne, userB: userTwo }
		: { userA: userTwo, userB: userOne };
}

function toDateValue(value) {
	if (value instanceof Date) return value;
	if (typeof value === 'number') {
		// Handle both epoch seconds and epoch milliseconds.
		const millis = value < 10_000_000_000 ? value * 1000 : value;
		return new Date(millis);
	}
	if (typeof value === 'string') {
		if (/^\d+$/.test(value)) {
			const numeric = Number.parseInt(value, 10);
			const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
			return new Date(millis);
		}

		return new Date(value);
	}

	return null;
}

async function ensureUserModeRows(db, userId) {
	const now = new Date();
	const existingRows = await db
		.select({ modeSeconds: userModeStats.modeSeconds })
		.from(userModeStats)
		.where(eq(userModeStats.userId, userId));

	const existingModeSet = new Set(existingRows.map((row) => row.modeSeconds));
	const missingModes = RANKED_MODE_SECONDS.filter((mode) => !existingModeSet.has(mode));

	if (missingModes.length === 0) {
		return;
	}

	await db
		.insert(userModeStats)
		.values(
			missingModes.map((modeSeconds) => ({
				userId,
				modeSeconds,
				gamesPlayed: 0,
				gamesWon: 0,
				gamesLost: 0,
				gamesDrawn: 0,
				totalScore: 0,
				rating: DEFAULT_RATING,
				updatedAt: now,
			}))
		)
		.onConflictDoNothing();
}

async function createFriendshipPair(db, userId, friendId) {
	const pair = resolveFriendshipPair(userId, friendId);
	if (!pair) return;

	const now = new Date();

	await db
		.insert(friendships)
		.values({ userA: pair.userA, userB: pair.userB, createdAt: now })
		.onConflictDoNothing();
}

// Public: Get leaderboard (top 10 players by rating)
userRouter.get('/leaderboard/top', async (c) => {
	try {
		const db = drizzle(c.env.DB);

		const topPlayers = await db
			.select({
				username: users.username,
				rating: users.rating,
				gamesPlayed: users.gamesPlayed,
				gamesWon: users.gamesWon,
				gamesLost: users.gamesLost,
			})
			.from(users)
			.orderBy(desc(users.rating))
			.limit(10);

		const leaderboard = topPlayers.map((player, index) => ({
			rank: index + 1,
			...player,
			winRate:
				player.gamesPlayed > 0
					? ((player.gamesWon / player.gamesPlayed) * 100).toFixed(1)
					: 0,
		}));

		return c.json({ leaderboard });
	} catch (error) {
		return c.json({ error: 'Failed to fetch leaderboard' }, 500);
	}
});

userRouter.get('/locations/countries', requireAuth, async (c) => {
	try {
		const query = String(c.req.query('query') || '').trim().toLowerCase();
		const parsedLimit = Number.parseInt(String(c.req.query('limit') || '15'), 10);
		const limit = Number.isFinite(parsedLimit)
			? Math.min(50, Math.max(1, parsedLimit))
			: 15;

		const countries = await fetchLocationCountries();
		const filtered = query
			? countries.filter((country) => country.toLowerCase().includes(query))
			: countries;

		return c.json({ countries: filtered.slice(0, limit) });
	} catch (error) {
		console.error('Failed to fetch countries:', error);
		return c.json({ error: 'Failed to fetch countries' }, 500);
	}
});

userRouter.get('/locations/cities', requireAuth, async (c) => {
	try {
		const country = normalizeOptionalLocationValue(c.req.query('country'));
		const query = String(c.req.query('query') || '').trim().toLowerCase();
		const parsedLimit = Number.parseInt(String(c.req.query('limit') || '15'), 10);
		const limit = Number.isFinite(parsedLimit)
			? Math.min(50, Math.max(1, parsedLimit))
			: 15;

		if (!country) {
			return c.json({ error: 'country query parameter is required' }, 400);
		}

		const cities = await fetchCitiesByCountry(country);
		const filtered = query
			? cities.filter((city) => city.toLowerCase().includes(query))
			: cities;

		return c.json({ country, cities: filtered.slice(0, limit) });
	} catch (error) {
		console.error('Failed to fetch cities:', error);
		return c.json({ error: 'Failed to fetch cities' }, 500);
	}
});

userRouter.get('/locations/geocode', requireAuth, async (c) => {
	try {
		const country = normalizeOptionalLocationValue(c.req.query('country'));
		const city = normalizeOptionalLocationValue(c.req.query('city'));

		if (!country || !city) {
			return c.json({ error: 'country and city are required' }, 400);
		}

		const coordinates = await fetchCityCoordinates(country, city);
		if (!coordinates) {
			return c.json({ error: 'City coordinates not found' }, 404);
		}

		return c.json({
			country,
			city,
			coordinates,
		});
	} catch (error) {
		console.error('Failed to geocode city:', error);
		return c.json({ error: 'Failed to geocode city' }, 500);
	}
});

userRouter.get('/globe/country-ratings', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const parsedMinUsers = Number.parseInt(String(c.req.query('minUsers') || '1'), 10);
		const minUsers = Number.isFinite(parsedMinUsers)
			? Math.min(50, Math.max(1, parsedMinUsers))
			: 1;

		const [countryRows, usersByCountryRows, countryModeRows, countryWinRows] = await Promise.all([
			fetch('https://restcountries.com/v3.1/all?fields=name,latlng,region')
				.then((response) => {
					if (!response.ok) {
						throw new Error(`Countries API returned ${response.status}`);
					}
					return response.json();
				}),
			db
				.select({
					country: users.country,
					avgRating: sql`avg(${users.rating})`,
					userCount: sql`count(*)`,
				})
				.from(users)
				.where(sql`${users.country} is not null and trim(${users.country}) <> ''`)
				.groupBy(users.country),
			db
				.select({
					country: users.country,
					modeSeconds: rankedGameLogs.modeSeconds,
					games: sql`count(*)`,
				})
				.from(rankedGameLogs)
				.innerJoin(users, eq(users.id, rankedGameLogs.userId))
				.where(sql`${users.country} is not null and trim(${users.country}) <> ''`)
				.groupBy(users.country, rankedGameLogs.modeSeconds),
			db
				.select({
					country: users.country,
					games: sql`count(*)`,
					wins: sql`sum(${rankedGameLogs.won})`,
				})
				.from(rankedGameLogs)
				.innerJoin(users, eq(users.id, rankedGameLogs.userId))
				.where(sql`${users.country} is not null and trim(${users.country}) <> ''`)
				.groupBy(users.country),
		]);

		const countryStatsByName = new Map(
			usersByCountryRows
				.map((row) => {
					const key = normalizeLocationKey(row.country);
					if (!key) return null;
					return [
						key,
						{
							avgRating: Math.round(Number(row.avgRating || 0)),
							userCount: Number(row.userCount || 0),
						},
					];
				})
				.filter(Boolean)
		);

		const countryWinRateByName = new Map(
			countryWinRows
				.map((row) => {
					const key = normalizeLocationKey(row.country);
					if (!key) return null;
					const games = Number(row.games || 0);
					const wins = Number(row.wins || 0);
					const avgWinRate = games > 0 ? Math.round((wins / games) * 100) : null;
					return [key, { avgWinRate }];
				})
				.filter(Boolean)
		);

		const countryModeByName = new Map();
		for (const row of countryModeRows) {
			const key = normalizeLocationKey(row.country);
			if (!key) continue;
			const games = Number(row.games || 0);
			const modeSeconds = Number(row.modeSeconds || 0);
			const current = countryModeByName.get(key);
			if (!current || games > current.games) {
				countryModeByName.set(key, {
					modeSeconds,
					games,
				});
			}
		}

		const countries = (Array.isArray(countryRows) ? countryRows : [])
			.map((country) => {
				const name = country?.name?.common;
				const lat = Number(country?.latlng?.[0]);
				const lng = Number(country?.latlng?.[1]);
				if (
					typeof name !== 'string' ||
					!name.trim() ||
					!Number.isFinite(lat) ||
					!Number.isFinite(lng)
				) {
					return null;
				}

				const key = normalizeLocationKey(name);
				const stats = key ? countryStatsByName.get(key) : null;
				const winStats = key ? countryWinRateByName.get(key) : null;
				const modeStats = key ? countryModeByName.get(key) : null;

				return {
					country: name.trim(),
					region: typeof country?.region === 'string' ? country.region : 'Other',
					lat,
					lng,
					avgRating: stats?.avgRating || null,
					avgWinRate: winStats?.avgWinRate ?? null,
					mostPlayedMode: Number.isFinite(modeStats?.modeSeconds)
						? modeStats.modeSeconds
						: null,
					userCount: stats?.userCount || 0,
				};
			})
			.filter(Boolean)
			.sort((a, b) => a.country.localeCompare(b.country));

		const markerCountries = countries.filter((country) => country.userCount >= minUsers);
		const regionSummary = Object.values(
			markerCountries.reduce((acc, country) => {
				const key = country.region || 'Other';
				if (!acc[key]) {
					acc[key] = {
						region: key,
						countries: 0,
						users: 0,
						ratingWeighted: 0,
					};
				}

				acc[key].countries += 1;
				acc[key].users += country.userCount;
				acc[key].ratingWeighted += (country.avgRating || 0) * country.userCount;
				return acc;
			}, {})
		)
			.map((entry) => ({
				region: entry.region,
				countries: entry.countries,
				users: entry.users,
				avgRating: entry.users > 0 ? Math.round(entry.ratingWeighted / entry.users) : null,
			}))
			.sort((a, b) => b.users - a.users);

		return c.json({
			countries,
			markerCountries,
			regionSummary,
			minUsers,
		});
	} catch (error) {
		console.error('Failed to build globe country ratings:', error);
		return c.json({ error: 'Failed to build globe country ratings' }, 500);
	}
});

// Authenticated: create (or get) the current user's profile
userRouter.post('/', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const body = await c.req.json().catch(() => ({}));
		const requestedUsername = body?.username;
		const auth = c.get('auth');
		const uid = auth?.uid;
		const email = auth?.email;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}
		if (!email) {
			return c.json(
				{ error: 'Account has no email; email is required to create a profile' },
				400
			);
		}
		const existingUser = await db.select().from(users).where(eq(users.id, uid)).limit(1);

		if (existingUser.length > 0) {
			return c.json({ user: existingUser[0], message: 'User already exists' });
		}

		const sanitizeBaseUsername = (value) => {
			if (typeof value !== 'string') return null;
			const trimmed = value.trim();
			if (trimmed.length < 3) return null;
			const cleaned = trimmed
				.toLowerCase()
				.replace(/\s+/g, '-')
				.replace(/[^a-z0-9._-]/g, '')
				.slice(0, 24);
			return cleaned.length >= 3 ? cleaned : null;
		};

		const emailLocalPart = email.split('@')[0] || 'player';
		const baseFromEmail = sanitizeBaseUsername(emailLocalPart) || 'player';
		const baseRequested = sanitizeBaseUsername(requestedUsername);
		const base = baseRequested || baseFromEmail;

		const isUsernameTaken = async (candidate) => {
			const rows = await db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.username, candidate))
				.limit(1);
			return rows.length > 0;
		};

		let chosenUsername = base;
		if (await isUsernameTaken(chosenUsername)) {
			if (baseRequested) {
				return c.json({ error: 'Username already taken' }, 409);
			}
			let attempt = 0;
			while (attempt < 5) {
				attempt++;
				const suffix = Math.random().toString(36).slice(2, 6);
				const candidate = `${base.slice(0, Math.max(3, 24 - suffix.length - 1))}-${suffix}`;
				if (!(await isUsernameTaken(candidate))) {
					chosenUsername = candidate;
					break;
				}
			}
		}

		let newUser;
		let attempts = 0;
		while (attempts < 3) {
			attempts++;
			try {
				newUser = await db
					.insert(users)
					.values({
						id: uid,
						username: chosenUsername,
						email,
						gamesPlayed: 0,
						gamesWon: 0,
						gamesLost: 0,
						rating: 800,
						createdAt: new Date(),
					})
					.returning();
				break;
			} catch (error) {
				console.error('Failed to insert user:', error);
				const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
				if (byEmail.length > 0 && byEmail[0].id !== uid) {
					return c.json(
						{ error: 'Email is already in use by a different account' },
						409
					);
				}
				if (baseRequested) {
					return c.json({ error: 'Username already taken' }, 409);
				}
				// Likely a username race; try a new suffix.
				const suffix = Math.random().toString(36).slice(2, 6);
				chosenUsername = `${base.slice(0, Math.max(3, 24 - suffix.length - 1))}-${suffix}`;
			}
		}

		if (!newUser || !newUser[0]) {
			return c.json({ error: 'Failed to create user' }, 500);
		}

		await ensureUserModeRows(db, uid);

		return c.json({ user: newUser[0], message: 'User created successfully' });
	} catch (error) {
		return c.json({ error: 'Failed to create user', details: error.message }, 500);
	}
});

userRouter.get('/:id', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const user = await db.select().from(users).where(eq(users.id, uid)).limit(1);

		if (user.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({ user: user[0] });
	} catch (error) {
		return c.json({ error: 'Failed to fetch user' }, 500);
	}
});

userRouter.get('/:id/location', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const rows = await db
			.select({ country: users.country, city: users.city })
			.from(users)
			.where(eq(users.id, uid))
			.limit(1);

		if (rows.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({
			country: rows[0].country || null,
			city: rows[0].city || null,
		});
	} catch (error) {
		console.error('Failed to fetch user location:', error);
		return c.json({ error: 'Failed to fetch user location' }, 500);
	}
});

userRouter.patch('/:id/location', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const body = await c.req.json().catch(() => ({}));
		const country = normalizeOptionalLocationValue(body?.country);
		const city = normalizeOptionalLocationValue(body?.city);

		if (!country && city) {
			return c.json({ error: 'country is required when city is provided' }, 400);
		}

		const rows = await db
			.update(users)
			.set({
				country,
				city,
			})
			.where(eq(users.id, uid))
			.returning({ country: users.country, city: users.city });

		if (rows.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({
			country: rows[0].country || null,
			city: rows[0].city || null,
		});
	} catch (error) {
		console.error('Failed to update user location:', error);
		return c.json({ error: 'Failed to update user location' }, 500);
	}
});

// Update game result with rating changes
userRouter.patch('/:id/game-result', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}
		const {
			won,
			isDraw,
			opponentId,
			score,
			opponentScore,
			modeSeconds: rawModeSeconds,
			gameId,
		} = await c.req.json();

		if (typeof gameId !== 'string' || gameId.trim().length === 0) {
			return c.json({ error: 'gameId is required' }, 400);
		}
		if (typeof opponentId !== 'string' || opponentId.length === 0) {
			return c.json({ error: 'opponentId is required' }, 400);
		}
		if (opponentId === uid) {
			return c.json({ error: 'opponentId must be different from player id' }, 400);
		}

		const modeSeconds = normalizeModeSeconds(rawModeSeconds);
		const gameWriteTime = new Date();

		const existingGame = await db
			.select({ id: games.id, modeSeconds: games.modeSeconds, status: games.status })
			.from(games)
			.where(eq(games.id, gameId))
			.limit(1);

		if (existingGame.length > 0) {
			if (existingGame[0].modeSeconds !== modeSeconds) {
				return c.json({ error: 'modeSeconds does not match the stored game mode' }, 409);
			}

			if (existingGame[0].status !== GAME_STATUS_FINISHED) {
				await db
					.update(games)
					.set({
						status: GAME_STATUS_FINISHED,
						finishedAt: gameWriteTime,
					})
					.where(eq(games.id, gameId));
			}
		} else {
			await db.insert(games).values({
				id: gameId,
				modeSeconds,
				difficulty: 'medium',
				seed: 0,
				status: GAME_STATUS_FINISHED,
				createdAt: gameWriteTime,
				finishedAt: gameWriteTime,
			});
		}

		const isGameDraw = Boolean(isDraw);
		const playerWon = isGameDraw ? false : Boolean(won);
		const playerScore = Math.max(0, Number.parseInt(String(score), 10) || 0);
		const rivalScore = Math.max(0, Number.parseInt(String(opponentScore), 10) || 0);

		const existingLog = await db
			.select({
				ratingAfter: rankedGameLogs.ratingAfter,
				ratingBefore: rankedGameLogs.ratingBefore,
			})
			.from(rankedGameLogs)
			.where(and(eq(rankedGameLogs.gameId, gameId), eq(rankedGameLogs.userId, uid)))
			.limit(1);

		if (existingLog.length > 0) {
			const [playerStatsRow] = await db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1);

			if (playerStatsRow) {
				return c.json({
					player: {
						id: uid,
						rating: playerStatsRow.rating,
					},
					modeStats: modeStatsRowToDto(playerStatsRow),
					ratingChange: existingLog[0].ratingAfter - existingLog[0].ratingBefore,
					idempotent: true,
				});
			}
		}

		// Get both players
		const [player, opponent] = await Promise.all([
			db.select().from(users).where(eq(users.id, uid)).limit(1),
			db.select().from(users).where(eq(users.id, opponentId)).limit(1),
		]);

		if (player.length === 0 || opponent.length === 0) {
			return c.json({ error: 'Player not found' }, 404);
		}

		const playerData = player[0];
		const opponentData = opponent[0];

		await Promise.all([ensureUserModeRows(db, uid), ensureUserModeRows(db, opponentId)]);

		const [playerModeStatsRows, opponentModeStatsRows] = await Promise.all([
			db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1),
			db
				.select()
				.from(userModeStats)
				.where(and(eq(userModeStats.userId, opponentId), eq(userModeStats.modeSeconds, modeSeconds)))
				.limit(1),
		]);

		const playerModeStats = playerModeStatsRows[0];
		const opponentModeStats = opponentModeStatsRows[0];

		if (!playerModeStats || !opponentModeStats) {
			return c.json({ error: 'Failed to initialize mode stats' }, 500);
		}

		// Calculate new ratings
		const playerResultScore = isGameDraw ? 0.5 : playerWon ? 1 : 0;
		const opponentResultScore = isGameDraw ? 0.5 : playerWon ? 0 : 1;

		const newPlayerRating = calculateNewRatings(
			playerModeStats.rating,
			opponentModeStats.rating,
			playerResultScore,
			{ gamesPlayed: playerModeStats.gamesPlayed }
		);
		const newOpponentRating = calculateNewRatings(
			opponentModeStats.rating,
			playerModeStats.rating,
			opponentResultScore,
			{ gamesPlayed: opponentModeStats.gamesPlayed }
		);

		const playerModeGamesPlayed = playerModeStats.gamesPlayed + 1;
		const opponentModeGamesPlayed = opponentModeStats.gamesPlayed + 1;
		const now = new Date();

		const updatedPlayerModeStatsPromise = db
			.update(userModeStats)
			.set({
				gamesPlayed: playerModeGamesPlayed,
				gamesWon: playerWon ? playerModeStats.gamesWon + 1 : playerModeStats.gamesWon,
				gamesLost: !isGameDraw && !playerWon ? playerModeStats.gamesLost + 1 : playerModeStats.gamesLost,
				gamesDrawn: isGameDraw ? playerModeStats.gamesDrawn + 1 : playerModeStats.gamesDrawn,
				totalScore: playerModeStats.totalScore + playerScore,
				rating: newPlayerRating,
				updatedAt: now,
			})
			.where(and(eq(userModeStats.userId, uid), eq(userModeStats.modeSeconds, modeSeconds)))
			.returning();

		const updatedOpponentModeStatsPromise = db
			.update(userModeStats)
			.set({
				gamesPlayed: opponentModeGamesPlayed,
				gamesWon: !isGameDraw && !playerWon ? opponentModeStats.gamesWon + 1 : opponentModeStats.gamesWon,
				gamesLost: playerWon ? opponentModeStats.gamesLost + 1 : opponentModeStats.gamesLost,
				gamesDrawn: isGameDraw ? opponentModeStats.gamesDrawn + 1 : opponentModeStats.gamesDrawn,
				totalScore: opponentModeStats.totalScore + rivalScore,
				rating: newOpponentRating,
				updatedAt: now,
			})
			.where(and(eq(userModeStats.userId, opponentId), eq(userModeStats.modeSeconds, modeSeconds)))
			.returning();

		// Update both players
		const [updatedPlayer, updatedOpponent, updatedPlayerModeStats, updatedOpponentModeStats] =
			await Promise.all([
			db
				.update(users)
				.set({
					gamesPlayed: playerData.gamesPlayed + 1,
					gamesWon: playerWon ? playerData.gamesWon + 1 : playerData.gamesWon,
					gamesLost: !isGameDraw && !playerWon ? playerData.gamesLost + 1 : playerData.gamesLost,
					rating: newPlayerRating,
				})
				.where(eq(users.id, uid))
				.returning(),

			db
				.update(users)
				.set({
					gamesPlayed: opponentData.gamesPlayed + 1,
					gamesWon: !isGameDraw && !playerWon ? opponentData.gamesWon + 1 : opponentData.gamesWon,
					gamesLost: playerWon ? opponentData.gamesLost + 1 : opponentData.gamesLost,
					rating: newOpponentRating,
				})
				.where(eq(users.id, opponentId))
				.returning(),
			updatedPlayerModeStatsPromise,
			updatedOpponentModeStatsPromise,
		]);

		await Promise.all([
			db.insert(rankedGameLogs).values({
				id: generateEntityId('match'),
				gameId,
				userId: uid,
				opponentId,
				modeSeconds,
				score: playerScore,
				opponentScore: rivalScore,
				won: playerWon ? 1 : 0,
				isDraw: isGameDraw ? 1 : 0,
				ratingBefore: playerModeStats.rating,
				ratingAfter: newPlayerRating,
				createdAt: now,
			}),
			db.insert(rankedGameLogs).values({
				id: generateEntityId('match'),
				gameId,
				userId: opponentId,
				opponentId: uid,
				modeSeconds,
				score: rivalScore,
				opponentScore: playerScore,
				won: !isGameDraw && !playerWon ? 1 : 0,
				isDraw: isGameDraw ? 1 : 0,
				ratingBefore: opponentModeStats.rating,
				ratingAfter: newOpponentRating,
				createdAt: now,
			}),
		]);

		return c.json({
			player: updatedPlayer[0],
			opponent: updatedOpponent[0],
			modeStats: modeStatsRowToDto(updatedPlayerModeStats[0]),
			opponentModeStats: modeStatsRowToDto(updatedOpponentModeStats[0]),
			ratingChange: newPlayerRating - playerModeStats.rating,
			opponentRatingChange: newOpponentRating - opponentModeStats.rating,
		});
	} catch (error) {
		console.error('Failed to update game result:', error);
		return c.json({ error: 'Failed to update game result' }, 500);
	}
});

userRouter.get('/:id/stats', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const user = await db
			.select({
				username: users.username,
				rating: users.rating,
			})
			.from(users)
			.where(eq(users.id, uid))
			.limit(1);

		if (user.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		await ensureUserModeRows(db, uid);

		const modeRows = await db
			.select()
			.from(userModeStats)
			.where(eq(userModeStats.userId, uid))
			.orderBy(userModeStats.modeSeconds);

		const stats = user[0];
		const aggregate = modeRows.reduce(
			(acc, row) => {
				acc.gamesPlayed += Number(row.gamesPlayed || 0);
				acc.gamesWon += Number(row.gamesWon || 0);
				acc.gamesLost += Number(row.gamesLost || 0);
				return acc;
			},
			{ gamesPlayed: 0, gamesWon: 0, gamesLost: 0 }
		);
		const winRate =
			aggregate.gamesPlayed > 0
				? ((aggregate.gamesWon / aggregate.gamesPlayed) * 100).toFixed(1)
				: 0;
		const modeStats = RANKED_MODE_SECONDS.map((modeSeconds) => {
			const row = modeRows.find((entry) => entry.modeSeconds === modeSeconds);
			if (!row) {
				return {
					modeSeconds,
					gamesPlayed: 0,
					gamesWon: 0,
					gamesLost: 0,
					gamesDrawn: 0,
					totalScore: 0,
					averageScore: 0,
					rating: DEFAULT_RATING,
				};
			}

			return modeStatsRowToDto(row);
		});

		return c.json({
			username: stats.username,
			gamesPlayed: aggregate.gamesPlayed,
			gamesWon: aggregate.gamesWon,
			gamesLost: aggregate.gamesLost,
			rating: stats.rating,
			winRate: parseFloat(winRate),
			modeStats,
		});
	} catch (error) {
		return c.json({ error: 'Failed to fetch user stats' }, 500);
	}
});

userRouter.get('/:id/activity', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const days = Math.min(365, Math.max(30, Number.parseInt(c.req.query('days') || '90', 10) || 90));
		const startDate = new Date();
		startDate.setHours(0, 0, 0, 0);
		startDate.setDate(startDate.getDate() - days + 1);

		const logs = await db
			.select({
				createdAt: rankedGameLogs.createdAt,
			})
			.from(rankedGameLogs)
			.where(eq(rankedGameLogs.userId, uid))
			.orderBy(rankedGameLogs.createdAt);

		const countsByDay = {};
		for (const row of logs) {
			const parsed = toDateValue(row.createdAt);
			if (!parsed || Number.isNaN(parsed.getTime()) || parsed < startDate) {
				continue;
			}

			parsed.setHours(0, 0, 0, 0);
			const dateKey = parsed.toISOString().slice(0, 10);
			countsByDay[dateKey] = (countsByDay[dateKey] || 0) + 1;
		}

		const activity = [];
		for (let index = 0; index < days; index++) {
			const date = new Date(startDate);
			date.setDate(startDate.getDate() + index);
			const dateKey = date.toISOString().slice(0, 10);
			activity.push({
				date: dateKey,
				count: countsByDay[dateKey] || 0,
			});
		}

		const maxCount = activity.reduce((max, day) => Math.max(max, day.count), 0);

		return c.json({
			days,
			maxCount,
			activity,
		});
	} catch (error) {
		console.error('Failed to fetch user activity:', error);
		return c.json({ error: 'Failed to fetch user activity' }, 500);
	}
});

userRouter.get('/:id/rating-trend', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const modeSeconds = normalizeModeSeconds(c.req.query('modeSeconds') || 60);
		const limit = Math.min(
			300,
			Math.max(10, Number.parseInt(c.req.query('limit') || '120', 10) || 120)
		);

		const rows = await db
			.select({
				gameId: rankedGameLogs.gameId,
				rating: rankedGameLogs.ratingAfter,
				score: rankedGameLogs.score,
				createdAt: rankedGameLogs.createdAt,
			})
			.from(rankedGameLogs)
			.where(
				and(eq(rankedGameLogs.userId, uid), eq(rankedGameLogs.modeSeconds, modeSeconds))
			)
			.orderBy(desc(rankedGameLogs.createdAt))
			.limit(limit);

		const points = rows
			.slice()
			.reverse()
			.map((row, index) => ({
				index: index + 1,
				gameId: row.gameId,
				rating: row.rating,
				score: row.score,
				date: new Date(row.createdAt).toISOString().slice(0, 10),
			}));

		return c.json({
			modeSeconds,
			points,
		});
	} catch (error) {
		console.error('Failed to fetch rating trend:', error);
		return c.json({ error: 'Failed to fetch rating trend' }, 500);
	}
});

userRouter.get('/me/friends', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const friendUser = alias(users, 'friend_user');

		const [asUserA, asUserB] = await Promise.all([
			db
				.select({
					id: friendUser.id,
					username: friendUser.username,
					rating: friendUser.rating,
					gamesPlayed: friendUser.gamesPlayed,
					gamesWon: friendUser.gamesWon,
					gamesLost: friendUser.gamesLost,
					friendsSince: friendships.createdAt,
				})
				.from(friendships)
				.innerJoin(friendUser, eq(friendships.userB, friendUser.id))
				.where(eq(friendships.userA, uid)),
			db
				.select({
					id: friendUser.id,
					username: friendUser.username,
					rating: friendUser.rating,
					gamesPlayed: friendUser.gamesPlayed,
					gamesWon: friendUser.gamesWon,
					gamesLost: friendUser.gamesLost,
					friendsSince: friendships.createdAt,
				})
				.from(friendships)
				.innerJoin(friendUser, eq(friendships.userA, friendUser.id))
				.where(eq(friendships.userB, uid)),
		]);

		const mergedFriends = [...asUserA, ...asUserB];
		const onlineMap = await buildOnlineMapWithPresence(
			c.env,
			db,
			mergedFriends.map((friend) => friend.id)
		);

		const friends = mergedFriends
			.map((friend) => ({
				...friend,
				online: Boolean(onlineMap.get(friend.id)),
			}))
			.sort(
			(a, b) => new Date(b.friendsSince).getTime() - new Date(a.friendsSince).getTime()
		);

		return c.json({ friends });
	} catch (error) {
		console.error('Failed to fetch friends:', error);
		return c.json({ error: 'Failed to fetch friends' }, 500);
	}
});

userRouter.get('/me/friend-requests', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const senderUser = alias(users, 'sender_user');
		const receiverUser = alias(users, 'receiver_user');

		const [incoming, outgoing] = await Promise.all([
			db
				.select({
					id: friendRequests.id,
					senderId: friendRequests.senderId,
					senderUsername: senderUser.username,
					senderRating: senderUser.rating,
					createdAt: friendRequests.createdAt,
				})
				.from(friendRequests)
				.innerJoin(senderUser, eq(friendRequests.senderId, senderUser.id))
				.where(
					and(
						eq(friendRequests.receiverId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING)
					)
				)
				.orderBy(desc(friendRequests.createdAt)),
			db
				.select({
					id: friendRequests.id,
					receiverId: friendRequests.receiverId,
					receiverUsername: receiverUser.username,
					receiverRating: receiverUser.rating,
					createdAt: friendRequests.createdAt,
				})
				.from(friendRequests)
				.innerJoin(receiverUser, eq(friendRequests.receiverId, receiverUser.id))
				.where(
					and(
						eq(friendRequests.senderId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING)
					)
				)
				.orderBy(desc(friendRequests.createdAt)),
		]);

		const onlineMap = await buildOnlineMapWithPresence(c.env, db, [
			...incoming.map((row) => row.senderId),
			...outgoing.map((row) => row.receiverId),
		]);

		return c.json({
			incoming: incoming.map((row) => ({
				...row,
				senderOnline: Boolean(onlineMap.get(row.senderId)),
			})),
			outgoing: outgoing.map((row) => ({
				...row,
				receiverOnline: Boolean(onlineMap.get(row.receiverId)),
			})),
		});
	} catch (error) {
		console.error('Failed to fetch friend requests:', error);
		return c.json({ error: 'Failed to fetch friend requests' }, 500);
	}
});

userRouter.patch('/me/presence', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		await db
			.update(users)
			.set({
				lastSeenAt: new Date(),
			})
			.where(eq(users.id, uid));

		return c.json({ ok: true, lastSeenAt: new Date().toISOString() });
	} catch (error) {
		console.error('Failed to update presence:', error);
		return c.json({ error: 'Failed to update presence' }, 500);
	}
});

userRouter.get('/me/search', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const rawQuery = c.req.query('query') || '';
		const query = rawQuery.trim().toLowerCase();

		if (query.length < 2 || !/^[a-z0-9._-]+$/.test(query)) {
			return c.json({ users: [] });
		}

		const matches = await db
			.select({
				id: users.id,
				username: users.username,
				rating: users.rating,
			})
			.from(users)
			.where(
				and(
					sql`lower(${users.username}) like ${`%${query}%`}`,
					sql`${users.id} <> ${uid}`
				)
			)
			.orderBy(
				sql`
					case
						when lower(${users.username}) = ${query} then 0
						when lower(${users.username}) like ${`${query}%`} then 1
						else 2
					end
				`,
				desc(users.rating)
			)
			.limit(8);

		if (matches.length === 0) {
			return c.json({ users: [] });
		}

		const candidateIds = matches.map((user) => user.id);

		const [friendRows, outgoingRows, incomingRows] = await Promise.all([
			db
				.select({ userA: friendships.userA, userB: friendships.userB })
				.from(friendships)
				.where(
					or(
						and(eq(friendships.userA, uid), inArray(friendships.userB, candidateIds)),
						and(eq(friendships.userB, uid), inArray(friendships.userA, candidateIds))
					)
				),
			db
				.select({ receiverId: friendRequests.receiverId })
				.from(friendRequests)
				.where(
					and(
						eq(friendRequests.senderId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING),
						inArray(friendRequests.receiverId, candidateIds)
					)
				),
			db
				.select({ senderId: friendRequests.senderId })
				.from(friendRequests)
				.where(
					and(
						eq(friendRequests.receiverId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING),
						inArray(friendRequests.senderId, candidateIds)
					)
				),
		]);

		const friendIdSet = new Set(
			friendRows.map((row) => (row.userA === uid ? row.userB : row.userA))
		);
		const outgoingIdSet = new Set(outgoingRows.map((row) => row.receiverId));
		const incomingIdSet = new Set(incomingRows.map((row) => row.senderId));

		const searchUsers = matches.map((user) => ({
			...user,
			isFriend: friendIdSet.has(user.id),
			hasOutgoingRequest: outgoingIdSet.has(user.id),
			hasIncomingRequest: incomingIdSet.has(user.id),
		}));

		return c.json({ users: searchUsers });
	} catch (error) {
		console.error('Failed to search users:', error);
		return c.json({ error: 'Failed to search users' }, 500);
	}
});

userRouter.post('/me/friend-requests', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const body = await c.req.json().catch(() => ({}));
		const username = normalizeUsername(body?.username);

		if (!username) {
			return c.json({ error: 'A valid username is required' }, 400);
		}

		const target = await db
			.select({ id: users.id, username: users.username })
			.from(users)
			.where(sql`lower(${users.username}) = ${username}`)
			.limit(1);

		if (target.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		const receiverId = target[0].id;

		if (receiverId === uid) {
			return c.json({ error: 'You cannot add yourself as a friend' }, 400);
		}

		const friendshipPair = resolveFriendshipPair(uid, receiverId);

		const [alreadyFriends] = await db
			.select({ userA: friendships.userA })
			.from(friendships)
			.where(
				or(
					and(
						eq(friendships.userA, friendshipPair.userA),
						eq(friendships.userB, friendshipPair.userB)
					),
					and(
						eq(friendships.userA, friendshipPair.userB),
						eq(friendships.userB, friendshipPair.userA)
					)
				)
			)
			.limit(1);

		if (alreadyFriends) {
			return c.json({ error: 'You are already friends with this user' }, 409);
		}

		const [existingOutgoing] = await db
			.select({ id: friendRequests.id })
			.from(friendRequests)
			.where(
				and(
					eq(friendRequests.senderId, uid),
					eq(friendRequests.receiverId, receiverId),
					eq(friendRequests.status, FRIEND_REQUEST_PENDING)
				)
			)
			.limit(1);

		if (existingOutgoing) {
			return c.json({ error: 'Friend request already sent' }, 409);
		}

		const [existingIncoming] = await db
			.select({ id: friendRequests.id })
			.from(friendRequests)
			.where(
				and(
					eq(friendRequests.senderId, receiverId),
					eq(friendRequests.receiverId, uid),
					eq(friendRequests.status, FRIEND_REQUEST_PENDING)
				)
			)
			.limit(1);

		if (existingIncoming) {
			await db
				.update(friendRequests)
				.set({
					status: FRIEND_REQUEST_ACCEPTED,
					respondedAt: new Date(),
				})
				.where(eq(friendRequests.id, existingIncoming.id));

			await createFriendshipPair(db, uid, receiverId);

			return c.json({
				message: 'Friend request accepted',
				autoAccepted: true,
				friend: {
					id: receiverId,
					username: target[0].username,
				},
			});
		}

		const requestId = generateEntityId('friend_req');

		await db.insert(friendRequests).values({
			id: requestId,
			senderId: uid,
			receiverId,
			status: FRIEND_REQUEST_PENDING,
			createdAt: new Date(),
			respondedAt: null,
		});

		return c.json({
			message: 'Friend request sent',
			request: {
				id: requestId,
				receiverId,
				receiverUsername: target[0].username,
			},
		});
	} catch (error) {
		console.error('Failed to send friend request:', error);
		return c.json({ error: 'Failed to send friend request' }, 500);
	}
});

userRouter.patch('/me/friend-requests/:requestId', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const requestId = c.req.param('requestId');
		const body = await c.req.json().catch(() => ({}));
		const action = body?.action;

		if (action !== 'accept' && action !== 'reject') {
			return c.json({ error: 'action must be either accept or reject' }, 400);
		}

		const [request] = await db
			.select({
				id: friendRequests.id,
				senderId: friendRequests.senderId,
				receiverId: friendRequests.receiverId,
				status: friendRequests.status,
			})
			.from(friendRequests)
			.where(
				and(
					eq(friendRequests.id, requestId),
					eq(friendRequests.receiverId, uid),
					eq(friendRequests.status, FRIEND_REQUEST_PENDING)
				)
			)
			.limit(1);

		if (!request) {
			return c.json({ error: 'Friend request not found or already handled' }, 404);
		}

		const nextStatus =
			action === 'accept' ? FRIEND_REQUEST_ACCEPTED : FRIEND_REQUEST_REJECTED;

		await db
			.update(friendRequests)
			.set({
				status: nextStatus,
				respondedAt: new Date(),
			})
			.where(eq(friendRequests.id, requestId));

		if (action === 'accept') {
			await createFriendshipPair(db, request.senderId, request.receiverId);
		}

		return c.json({
			message: action === 'accept' ? 'Friend request accepted' : 'Friend request rejected',
			request: {
				id: request.id,
				senderId: request.senderId,
				receiverId: request.receiverId,
				status: nextStatus,
			},
		});
	} catch (error) {
		console.error('Failed to handle friend request:', error);
		return c.json({ error: 'Failed to handle friend request' }, 500);
	}
});

userRouter.get('/me/room-invites', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const inviterUser = alias(users, 'inviter_user');

		const invites = await db
			.select({
				id: roomInvites.id,
				roomCode: roomInvites.roomCode,
				status: roomInvites.status,
				createdAt: roomInvites.createdAt,
				inviterId: roomInvites.inviterId,
				inviterUsername: inviterUser.username,
			})
			.from(roomInvites)
			.innerJoin(inviterUser, eq(roomInvites.inviterId, inviterUser.id))
			.where(eq(roomInvites.inviteeId, uid))
			.orderBy(desc(roomInvites.createdAt));

		const onlineMap = await buildOnlineMapWithPresence(
			c.env,
			db,
			invites.map((invite) => invite.inviterId)
		);

		return c.json({
			invites: invites.map((invite) => ({
				...invite,
				inviterOnline: Boolean(onlineMap.get(invite.inviterId)),
			})),
		});
	} catch (error) {
		console.error('Failed to fetch room invites:', error);
		return c.json({ error: 'Failed to fetch room invites' }, 500);
	}
});

userRouter.post('/me/room-invites', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const body = await c.req.json().catch(() => ({}));
		const roomCode = normalizeRoomCode(body?.roomCode);
		const inviteeId = typeof body?.inviteeId === 'string' ? body.inviteeId : null;

		if (!roomCode || !inviteeId) {
			return c.json({ error: 'roomCode and inviteeId are required' }, 400);
		}

		if (inviteeId === uid) {
			return c.json({ error: 'You cannot invite yourself' }, 400);
		}

		const pair = resolveFriendshipPair(uid, inviteeId);
		if (!pair) {
			return c.json({ error: 'Invalid invitee' }, 400);
		}

		const [friendLink] = await db
			.select({ userA: friendships.userA })
			.from(friendships)
			.where(
				or(
					and(eq(friendships.userA, pair.userA), eq(friendships.userB, pair.userB)),
					and(eq(friendships.userA, pair.userB), eq(friendships.userB, pair.userA))
				)
			)
			.limit(1);

		if (!friendLink) {
			return c.json({ error: 'You can only invite friends' }, 403);
		}

		const onlineMap = await buildOnlineMapWithPresence(c.env, db, [inviteeId]);
		if (!onlineMap.get(inviteeId)) {
			return c.json({ error: 'Friend is offline' }, 409);
		}

		const [existingPending] = await db
			.select({ id: roomInvites.id })
			.from(roomInvites)
			.where(
				and(
					eq(roomInvites.roomCode, roomCode),
					eq(roomInvites.inviterId, uid),
					eq(roomInvites.inviteeId, inviteeId),
					eq(roomInvites.status, ROOM_INVITE_PENDING)
				)
			)
			.limit(1);

		if (existingPending) {
			return c.json({ error: 'Invite already sent' }, 409);
		}

		const inviteId = generateEntityId('room_invite');
		await db.insert(roomInvites).values({
			id: inviteId,
			roomCode,
			inviterId: uid,
			inviteeId,
			status: ROOM_INVITE_PENDING,
			createdAt: new Date(),
			respondedAt: null,
		});

		return c.json({
			message: 'Room invite sent',
			invite: {
				id: inviteId,
				roomCode,
				inviteeId,
				status: ROOM_INVITE_PENDING,
			},
		});
	} catch (error) {
		console.error('Failed to send room invite:', error);
		return c.json({ error: 'Failed to send room invite' }, 500);
	}
});

userRouter.patch('/me/room-invites/:inviteId', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const inviteId = c.req.param('inviteId');
		const body = await c.req.json().catch(() => ({}));
		const action = body?.action;

		if (action !== 'accept' && action !== 'reject') {
			return c.json({ error: 'action must be either accept or reject' }, 400);
		}

		const [invite] = await db
			.select({
				id: roomInvites.id,
				roomCode: roomInvites.roomCode,
				status: roomInvites.status,
			})
			.from(roomInvites)
			.where(
				and(
					eq(roomInvites.id, inviteId),
					eq(roomInvites.inviteeId, uid),
					eq(roomInvites.status, ROOM_INVITE_PENDING)
				)
			)
			.limit(1);

		if (!invite) {
			return c.json({ error: 'Invite not found or already handled' }, 404);
		}

		const nextStatus = action === 'accept' ? ROOM_INVITE_ACCEPTED : ROOM_INVITE_REJECTED;

		await db
			.update(roomInvites)
			.set({
				status: nextStatus,
				respondedAt: new Date(),
			})
			.where(eq(roomInvites.id, inviteId));

		return c.json({
			message: action === 'accept' ? 'Invite accepted' : 'Invite rejected',
			invite: {
				id: invite.id,
				roomCode: invite.roomCode,
				status: nextStatus,
			},
		});
	} catch (error) {
		console.error('Failed to respond to room invite:', error);
		return c.json({ error: 'Failed to respond to room invite' }, 500);
	}
});

userRouter.get('/me/notifications', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const [pendingFriendRows, pendingRoomInviteRows] = await Promise.all([
			db
				.select({ id: friendRequests.id })
				.from(friendRequests)
				.where(
					and(
						eq(friendRequests.receiverId, uid),
						eq(friendRequests.status, FRIEND_REQUEST_PENDING)
					)
				),
			db
				.select({ id: roomInvites.id })
				.from(roomInvites)
				.where(
					and(
						eq(roomInvites.inviteeId, uid),
						eq(roomInvites.status, ROOM_INVITE_PENDING)
					)
				),
		]);

		return c.json({
			pendingFriendRequests: pendingFriendRows.length,
			pendingRoomInvites: pendingRoomInviteRows.length,
			total: pendingFriendRows.length + pendingRoomInviteRows.length,
		});
	} catch (error) {
		console.error('Failed to fetch notifications:', error);
		return c.json({ error: 'Failed to fetch notifications' }, 500);
	}
});

userRouter.delete('/me/friends/:friendId', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const uid = auth?.uid;

		if (!uid) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		const friendId = c.req.param('friendId');

		if (!friendId || friendId === uid) {
			return c.json({ error: 'Invalid friend id' }, 400);
		}

		const pair = resolveFriendshipPair(uid, friendId);
		if (!pair) {
			return c.json({ error: 'Invalid friend id' }, 400);
		}

		const [friendLink] = await db
			.select({ userA: friendships.userA })
			.from(friendships)
			.where(
				or(
					and(eq(friendships.userA, pair.userA), eq(friendships.userB, pair.userB)),
					and(eq(friendships.userA, pair.userB), eq(friendships.userB, pair.userA))
				)
			)
			.limit(1);

		if (!friendLink) {
			return c.json({ error: 'Friend not found' }, 404);
		}

		await Promise.all([
			db
				.delete(friendships)
				.where(
					or(
						and(eq(friendships.userA, pair.userA), eq(friendships.userB, pair.userB)),
						and(eq(friendships.userA, pair.userB), eq(friendships.userB, pair.userA))
					)
				),
			db.delete(friendRequests).where(
				and(
					eq(friendRequests.status, FRIEND_REQUEST_PENDING),
					or(
						and(
							eq(friendRequests.senderId, uid),
							eq(friendRequests.receiverId, friendId)
						),
						and(
							eq(friendRequests.senderId, friendId),
							eq(friendRequests.receiverId, uid)
						)
					)
				)
			),
		]);

		return c.json({ message: 'Friend removed successfully' });
	} catch (error) {
		console.error('Failed to remove friend:', error);
		return c.json({ error: 'Failed to remove friend' }, 500);
	}
});

export default userRouter;
