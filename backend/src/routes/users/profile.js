import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne, sql } from 'drizzle-orm';
import { users } from '../../db/schema.js';
import { requireFirebaseAuth } from '../../middleware/firebaseAuth.js';
import { generateGuestEmail, generateGuestUsername, isGuestEmail } from '../../utils/guest.js';
import {
	countryFromIpHeader,
	normalizeOptionalLocationValue,
	normalizeUsername,
} from '../../services/validation.js';
import { ensureUserModeRows } from '../../services/user-stats.js';
import { randomSuffix } from '../../services/ids.js';
import { logger } from '../../services/logger.js';

const profileRouter = new Hono();
const requireAuth = requireFirebaseAuth();

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

const buildUsernameCandidate = (base, suffix) =>
	`${base.slice(0, Math.max(3, 24 - suffix.length - 1))}-${suffix}`;

// Authenticated: create (or get) the current user's profile
profileRouter.post('/', requireAuth, async (c) => {
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

		// Anonymous (guest) tokens have no email claim. Auto-provision a
		// profile with a synthetic email so the users table constraint holds.
		const isGuest = !email;
		const profileEmail = isGuest ? generateGuestEmail(uid) : email;

		const existingUser = await db.select().from(users).where(eq(users.id, uid)).limit(1);

		if (existingUser.length > 0) {
			const stored = existingUser[0];

			// Guest upgraded to a permanent account (Firebase credential link
			// preserves the UID): replace the synthetic email with the real one.
			if (!isGuest && isGuestEmail(stored.email)) {
				const byEmail = await db
					.select({ id: users.id })
					.from(users)
					.where(eq(users.email, email))
					.limit(1);
				if (byEmail.length > 0 && byEmail[0].id !== uid) {
					return c.json(
						{ error: 'Email is already in use by a different account' },
						409
					);
				}
				const [upgraded] = await db
					.update(users)
					.set({ email })
					.where(eq(users.id, uid))
					.returning();
				return c.json({ user: upgraded, message: 'User upgraded to permanent account' });
			}

			return c.json({ user: stored, message: 'User already exists' });
		}

		const emailLocalPart = email ? email.split('@')[0] || 'player' : null;
		const baseFromEmail = emailLocalPart ? sanitizeBaseUsername(emailLocalPart) || 'player' : null;
		const baseRequested = sanitizeBaseUsername(requestedUsername);
		const base = baseRequested || baseFromEmail || generateGuestUsername();

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
				const suffix = randomSuffix();
				const candidate = buildUsernameCandidate(base, suffix);
				if (!(await isUsernameTaken(candidate))) {
					chosenUsername = candidate;
					break;
				}
			}
		}

		let newUser;
		const ipCountry = countryFromIpHeader(c.req.header('cf-ip-country'));
		let attempts = 0;
		while (attempts < 3) {
			attempts++;
			try {
				newUser = await db
					.insert(users)
					.values({
						id: uid,
						username: chosenUsername,
						email: profileEmail,
						gamesPlayed: 0,
						gamesWon: 0,
						gamesLost: 0,
						rating: 800,
						nextWordCondition: 'auto',
						createdAt: new Date(),
						...(ipCountry ? { country: ipCountry } : {}),
					})
					.returning();
				break;
			} catch (error) {
				logger.warn('Failed to insert user', { error: error?.message });
				const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, profileEmail)).limit(1);
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
				chosenUsername = buildUsernameCandidate(base, randomSuffix());
			}
		}

		if (!newUser || !newUser[0]) {
			return c.json({ error: 'Failed to create user' }, 500);
		}

		await ensureUserModeRows(db, uid);

		return c.json({ user: newUser[0], message: 'User created successfully' });
	} catch (error) {
		logger.error('Failed to create user', { error: error?.message });
		return c.json({ error: 'Failed to create user', details: error.message }, 500);
	}
});

// Case-insensitive username availability check (excludes the requester).
profileRouter.get('/username/available', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const auth = c.get('auth');
		const raw = c.req.query('username');
		const username = normalizeUsername(raw);
		if (!username) {
			return c.json({ available: false, valid: false }, 200);
		}

		const taken = await db
			.select({ id: users.id })
			.from(users)
			.where(and(sql`lower(${users.username}) = ${username}`, ne(users.id, auth?.uid)))
			.limit(1);

		return c.json({ available: taken.length === 0, valid: true }, 200);
	} catch (error) {
		logger.error('Failed to check username availability', { error: error?.message });
		return c.json({ error: 'Failed to check username availability' }, 500);
	}
});

profileRouter.get('/:id', requireAuth, async (c) => {
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
		logger.error('Failed to fetch user', { error: error?.message });
		return c.json({ error: 'Failed to fetch user' }, 500);
	}
});

profileRouter.patch('/:id/preferences', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const body = await c.req.json().catch(() => ({}));
		const hasCondition = typeof body?.nextWordCondition === 'string';
		const rawCondition = hasCondition ? String(body.nextWordCondition).trim().toLowerCase() : '';
		const nextWordCondition =
			rawCondition === 'manual' ? 'manual' : rawCondition === 'auto' ? 'auto' : null;

		if (!hasCondition) {
			return c.json({ error: 'No updatable preferences provided' }, 400);
		}

		if (!nextWordCondition) {
			return c.json({ error: 'nextWordCondition must be auto or manual' }, 400);
		}

		const rows = await db
			.update(users)
			.set({ nextWordCondition })
			.where(eq(users.id, uid))
			.returning({ nextWordCondition: users.nextWordCondition });

		if (rows.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({
			nextWordCondition: rows[0].nextWordCondition,
		});
	} catch (error) {
		logger.error('Failed to update user preferences', { error: error?.message });
		return c.json({ error: 'Failed to update user preferences' }, 500);
	}
});

profileRouter.get('/:id/location', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const rows = await db
			.select({ country: users.country })
			.from(users)
			.where(eq(users.id, uid))
			.limit(1);

		if (rows.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({
			country: rows[0].country || null,
		});
	} catch (error) {
		logger.error('Failed to fetch user location', { error: error?.message });
		return c.json({ error: 'Failed to fetch user location' }, 500);
	}
});

profileRouter.patch('/:id/location', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const body = await c.req.json().catch(() => ({}));
		const country = normalizeOptionalLocationValue(body?.country);

		const rows = await db
			.update(users)
			.set({
				country,
			})
			.where(eq(users.id, uid))
			.returning({ country: users.country });

		if (rows.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({
			country: rows[0].country || null,
		});
	} catch (error) {
		logger.error('Failed to update user location', { error: error?.message });
		return c.json({ error: 'Failed to update user location' }, 500);
	}
});

// Update the current user's username (case-insensitively unique)
profileRouter.patch('/:id/username', requireAuth, async (c) => {
	try {
		const db = drizzle(c.env.DB);
		const uid = c.req.param('id');
		const auth = c.get('auth');
		if (auth?.uid !== uid) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		const body = await c.req.json().catch(() => ({}));
		const username = normalizeUsername(body?.username);
		if (!username) {
			return c.json(
				{
					error:
						'Username must be 3-24 characters and contain only letters, numbers, dots, dashes or underscores',
				},
				400
			);
		}

		const taken = await db
			.select({ id: users.id })
			.from(users)
			.where(and(sql`lower(${users.username}) = ${username}`, ne(users.id, uid)))
			.limit(1);

		if (taken.length > 0) {
			return c.json({ error: 'That username is already taken' }, 409);
		}

		const rows = await db
			.update(users)
			.set({ username })
			.where(eq(users.id, uid))
			.returning({ username: users.username });

		if (rows.length === 0) {
			return c.json({ error: 'User not found' }, 404);
		}

		return c.json({ username: rows[0].username });
	} catch (error) {
		logger.error('Failed to update username', { error: error?.message });
		return c.json({ error: 'Failed to update username' }, 500);
	}
});

export default profileRouter;
