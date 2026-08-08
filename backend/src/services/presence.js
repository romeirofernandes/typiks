import { eq, inArray } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { isRecentlyOnline } from './validation.js';
import { logger } from './logger.js';

export async function buildOnlineMap(db, userIds) {
	const ids = Array.from(new Set((userIds || []).filter(Boolean)));
	if (ids.length === 0) return new Map();

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

export async function buildOnlineMapFromPresenceHub(env, userIds) {
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
		logger.warn('Presence hub lookup failed', { error: error?.message });
		return null;
	}
}

export async function buildOnlineMapWithPresence(env, db, userIds) {
	const presenceMap = await buildOnlineMapFromPresenceHub(env, userIds);
	if (presenceMap) return presenceMap;
	return buildOnlineMap(db, userIds);
}

export async function notifyUser(env, userId, payload = {}) {
	if (!env?.PRESENCE_HUB || !userId) return;

	try {
		const id = env.PRESENCE_HUB.idFromName('global-presence-hub');
		const hub = env.PRESENCE_HUB.get(id);
		await hub.fetch('https://presence.internal/notify', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ userId, payload }),
		});
	} catch (error) {
		logger.warn('Failed to push realtime notification', { error: error?.message });
	}
}
