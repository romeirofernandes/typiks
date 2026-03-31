import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS_URL = new URL(
	'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
);

const jwks = createRemoteJWKSet(FIREBASE_JWKS_URL);

export async function verifyFirebaseIdToken(idToken, { projectId }) {
	if (!projectId) {
		throw new Error('Missing FIREBASE_PROJECT_ID');
	}

	const issuer = `https://securetoken.google.com/${projectId}`;
	const { payload } = await jwtVerify(idToken, jwks, {
		issuer,
		audience: projectId,
	});

	if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
		throw new Error('Invalid Firebase token subject');
	}

	return {
		uid: payload.sub,
		email: typeof payload.email === 'string' ? payload.email : null,
		emailVerified: Boolean(payload.email_verified),
		name: typeof payload.name === 'string' ? payload.name : null,
		picture: typeof payload.picture === 'string' ? payload.picture : null,
	};
}

export function requireFirebaseAuth() {
	return async (c, next) => {
		const authHeader = c.req.header('authorization') || '';
		const match = authHeader.match(/^Bearer\s+(.+)$/i);
		if (!match) {
			return c.json({ error: 'Missing Authorization: Bearer <token>' }, 401);
		}

		try {
			const claims = await verifyFirebaseIdToken(match[1], {
				projectId: c.env.FIREBASE_PROJECT_ID,
			});
			c.set('auth', claims);
			return await next();
		} catch (error) {
			console.error('Firebase auth failed:', error);
			return c.json({ error: 'Unauthorized' }, 401);
		}
	};
}
