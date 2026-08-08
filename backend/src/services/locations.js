import { LOCATION_CACHE_TTL_MS } from '../config.js';
import { normalizeLocationKey } from './validation.js';
import { logger } from './logger.js';
import countriesGeo from '../data/countries-geo.json' with { type: 'json' };

const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;
const MAX_CITIES_CACHE_ENTRIES = 200;
const MAX_GEOCODE_CACHE_ENTRIES = 500;

const locationCache = {
	countries: {
		data: null,
		expiresAt: 0,
	},
	citiesByCountry: new Map(),
	cityGeocodes: new Map(),
};

// Reads a JSON body from a Response while capping how many bytes are
// buffered, so an unexpectedly large upstream payload cannot blow up the
// Worker's memory (Workers subrequests are also limited to ~100MB, but this
// keeps our own copies small).
async function readJsonWithLimit(response, maxBytes = MAX_JSON_RESPONSE_BYTES) {
	const contentLength = Number(response.headers.get('content-length') || 0);
	if (contentLength > maxBytes) {
		throw new Error(`Response body too large (${contentLength} bytes)`);
	}

	const reader = response.body?.getReader();
	if (!reader) {
		return response.json();
	}

	const chunks = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > maxBytes) {
			await reader.cancel();
			throw new Error(`Response body exceeds ${maxBytes} bytes`);
		}
		chunks.push(value);
	}

	const combined = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return JSON.parse(new TextDecoder().decode(combined));
}

function cacheGet(map, key, now) {
	const cached = map.get(key);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}
	map.delete(key);
	return undefined;
}

function cacheSet(map, key, data, now, maxEntries) {
	if (map.size >= maxEntries) {
		const oldestKey = map.keys().next().value;
		if (oldestKey !== undefined) {
			map.delete(oldestKey);
		}
	}
	map.set(key, { data, expiresAt: now + LOCATION_CACHE_TTL_MS });
}

export async function fetchLocationCountries() {
	const now = Date.now();
	if (
		Array.isArray(locationCache.countries.data) &&
		locationCache.countries.expiresAt > now
	) {
		return locationCache.countries.data;
	}

	const countries = Array.isArray(countriesGeo)
		? countriesGeo
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

export async function fetchCitiesByCountry(country) {
	const key = country.toLowerCase();
	const now = Date.now();
	const cached = cacheGet(locationCache.citiesByCountry, key, now);
	if (cached !== undefined) {
		return cached;
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

	const payload = await readJsonWithLimit(response);
	const cities = Array.isArray(payload?.data)
		? payload.data
				.filter((city) => typeof city === 'string' && city.trim().length > 0)
				.map((city) => city.trim())
				.sort((a, b) => a.localeCompare(b))
		: [];

	cacheSet(locationCache.citiesByCountry, key, cities, now, MAX_CITIES_CACHE_ENTRIES);

	return cities;
}

export async function fetchCityCoordinates(country, city) {
	const normalizedCountry = normalizeLocationKey(country);
	const normalizedCity = normalizeLocationKey(city);

	if (!normalizedCountry || !normalizedCity) {
		return null;
	}

	const cacheKey = `${normalizedCountry}::${normalizedCity}`;
	const now = Date.now();
	const cached = cacheGet(locationCache.cityGeocodes, cacheKey, now);
	if (cached !== undefined) {
		return cached;
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

	const payload = await readJsonWithLimit(response);
	const first = Array.isArray(payload) ? payload[0] : null;
	const lat = Number.parseFloat(first?.lat);
	const lng = Number.parseFloat(first?.lon);
	const data = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

	cacheSet(locationCache.cityGeocodes, cacheKey, data, now, MAX_GEOCODE_CACHE_ENTRIES);

	return data;
}

export function resetLocationCacheForTests() {
	locationCache.countries = { data: null, expiresAt: 0 };
	locationCache.citiesByCountry.clear();
	locationCache.cityGeocodes.clear();
}
