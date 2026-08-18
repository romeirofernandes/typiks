import { RANKED_MODE_SECONDS, ONLINE_WINDOW_MS } from '../config.js';
import isoCountries from '../data/iso-countries.json' with { type: 'json' };

export function normalizeLocationKey(value) {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : null;
}

// Cloudflare injects a CF-IPCountry header (ISO 3166-1 alpha-2) on every
// request to the Worker. Best-effort: resolve it to the country common name
// used across the location/globe features, or null when unavailable.
export function countryFromIpHeader(headerValue) {
	if (typeof headerValue !== 'string') return null;
	const code = headerValue.trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(code)) return null;
	return isoCountries[code] || null;
}

export function normalizeUsername(value) {
	if (typeof value !== 'string') return null;
	const username = value.trim().toLowerCase();
	if (username.length < 3 || username.length > 24) return null;
	if (!/^[a-z0-9._-]+$/.test(username)) return null;
	return username;
}

export function normalizeModeSeconds(rawValue) {
	const parsed = Number.parseInt(String(rawValue), 10);
	if (!Number.isFinite(parsed) || !RANKED_MODE_SECONDS.includes(parsed)) {
		return 60;
	}

	return parsed;
}

export function normalizeOptionalLocationValue(value, maxLength = 80) {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().slice(0, maxLength);
	return normalized.length > 0 ? normalized : null;
}

export function normalizeRoomCode(value) {
	if (typeof value !== 'string') return null;
	const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	return code.length === 6 ? code : null;
}

export function isRecentlyOnline(lastSeenAt) {
	if (!lastSeenAt) return false;
	const value = new Date(lastSeenAt).getTime();
	if (!Number.isFinite(value)) return false;
	return Date.now() - value <= ONLINE_WINDOW_MS;
}

export function toDateValue(value) {
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
