import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { users, rankedGameLogs } from '../../db/schema.js';
import { requireFirebaseAuth } from '../../middleware/firebaseAuth.js';
import { normalizeLocationKey, normalizeOptionalLocationValue } from '../../services/validation.js';
import {
	fetchLocationCountries,
	fetchCitiesByCountry,
	fetchCityCoordinates,
} from '../../services/locations.js';
import { logger } from '../../services/logger.js';
import countriesGeo from '../../data/countries-geo.json' with { type: 'json' };

const locationsRouter = new Hono();
const requireAuth = requireFirebaseAuth();

locationsRouter.get('/countries', requireAuth, async (c) => {
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
		logger.error('Failed to fetch countries', { error: error?.message });
		return c.json({ error: 'Failed to fetch countries' }, 500);
	}
});

locationsRouter.get('/cities', requireAuth, async (c) => {
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
		logger.error('Failed to fetch cities', { error: error?.message });
		return c.json({ error: 'Failed to fetch cities' }, 500);
	}
});

locationsRouter.get('/geocode', requireAuth, async (c) => {
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
		logger.error('Failed to geocode city', { error: error?.message });
		return c.json({ error: 'Failed to geocode city' }, 500);
	}
});

locationsRouter.get('/globe/country-ratings', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const parsedMinUsers = Number.parseInt(String(c.req.query('minUsers') || '1'), 10);
		const minUsers = Number.isFinite(parsedMinUsers)
			? Math.min(50, Math.max(1, parsedMinUsers))
			: 1;

		const [countryRows, usersByCountryRows, countryModeRows, countryWinRows] = await Promise.all([
			Promise.resolve(countriesGeo),
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
		logger.error('Failed to build globe country ratings', { error: error?.message });
		return c.json({ error: 'Failed to build globe country ratings' }, 500);
	}
});

export default locationsRouter;
