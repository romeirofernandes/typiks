import { verifyFirebaseIdToken } from '../middleware/firebaseAuth.js';

const PRESENCE_TIMEOUT_MS = 45_000;
const ALARM_INTERVAL_MS = 15_000;

export class PresenceHub {
	constructor(controller, env) {
		this.controller = controller;
		this.env = env;
		this.sessions = new Map();
		this.userSessions = new Map();
	}

	async fetch(request) {
		const url = new URL(request.url);

		if (request.headers.get('upgrade') === 'websocket') {
			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);
			this.handleSession(server);
			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		}

		if (url.pathname === '/online' && request.method === 'POST') {
			const body = await request.json().catch(() => ({}));
			const ids = Array.isArray(body?.userIds)
				? body.userIds.filter((id) => typeof id === 'string' && id.length > 0)
				: [];
			const now = Date.now();
			const onlineMap = {};
			for (const id of ids) {
				onlineMap[id] = this.isUserOnline(id, now);
			}
			return Response.json({ onlineMap });
		}

		return new Response('Not found', { status: 404 });
	}

	handleSession(webSocket) {
		webSocket.accept();
		const sessionId = this.generateSessionId();

		this.sessions.set(sessionId, {
			webSocket,
			userId: null,
			visible: false,
			lastPingAt: Date.now(),
		});

		void this.ensureAlarm();

		webSocket.addEventListener('message', async (event) => {
			const payload = this.parseMessage(event.data);
			if (!payload || typeof payload.type !== 'string') return;

			const session = this.sessions.get(sessionId);
			if (!session) return;

			switch (payload.type) {
				case 'AUTH': {
					try {
						const idToken = payload?.idToken;
						if (typeof idToken !== 'string' || idToken.length === 0) {
							throw new Error('Missing idToken');
						}

						const claims = await verifyFirebaseIdToken(idToken, {
							projectId: this.env.FIREBASE_PROJECT_ID,
						});

						const userId = claims.uid;
						this.bindSessionToUser(sessionId, userId);
						session.visible = Boolean(payload?.visible);
						session.lastPingAt = Date.now();

						this.sendToSession(sessionId, {
							type: 'PRESENCE_AUTH_OK',
						});
					} catch (error) {
						this.sendToSession(sessionId, {
							type: 'PRESENCE_AUTH_ERROR',
							error: 'UNAUTHORIZED',
						});
						this.closeSession(sessionId, 1008, 'Unauthorized');
					}
					break;
				}

				case 'VISIBILITY': {
					session.visible = Boolean(payload?.visible);
					session.lastPingAt = Date.now();
					break;
				}

				case 'PING': {
					session.lastPingAt = Date.now();
					break;
				}

				default:
					break;
			}
		});

		webSocket.addEventListener('close', () => {
			this.removeSession(sessionId);
		});

		webSocket.addEventListener('error', () => {
			this.removeSession(sessionId);
		});
	}

	parseMessage(data) {
		if (typeof data !== 'string') return null;
		try {
			const parsed = JSON.parse(data);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	}

	bindSessionToUser(sessionId, userId) {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		if (session.userId && session.userId !== userId) {
			this.detachSessionFromUser(sessionId, session.userId);
		}

		session.userId = userId;

		if (!this.userSessions.has(userId)) {
			this.userSessions.set(userId, new Set());
		}
		this.userSessions.get(userId).add(sessionId);
	}

	detachSessionFromUser(sessionId, userId) {
		const sessions = this.userSessions.get(userId);
		if (!sessions) return;
		sessions.delete(sessionId);
		if (sessions.size === 0) {
			this.userSessions.delete(userId);
		}
	}

	removeSession(sessionId) {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		this.sessions.delete(sessionId);
		if (session.userId) {
			this.detachSessionFromUser(sessionId, session.userId);
		}
	}

	isUserOnline(userId, now = Date.now()) {
		const sessionIds = this.userSessions.get(userId);
		if (!sessionIds || sessionIds.size === 0) return false;

		for (const sessionId of sessionIds) {
			const session = this.sessions.get(sessionId);
			if (!session) continue;
			if (!session.visible) continue;
			if (now - session.lastPingAt > PRESENCE_TIMEOUT_MS) continue;
			if (!this.isSocketOpen(session.webSocket)) continue;
			return true;
		}

		return false;
	}

	isSocketOpen(webSocket) {
		if (!webSocket) return false;
		const openStates = [WebSocket.OPEN, WebSocket.READY_STATE_OPEN, 1].filter((state) => Number.isFinite(state));
		return openStates.includes(webSocket.readyState);
	}

	closeSession(sessionId, code = 1000, reason = 'Closing session') {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		try {
			session.webSocket.close(code, reason);
		} catch {
			// ignore close errors
		}
		this.removeSession(sessionId);
	}

	sendToSession(sessionId, payload) {
		const session = this.sessions.get(sessionId);
		if (!session || !this.isSocketOpen(session.webSocket)) return;
		try {
			session.webSocket.send(JSON.stringify(payload));
		} catch {
			// ignore send errors
		}
	}

	generateSessionId() {
		if (typeof crypto?.randomUUID === 'function') {
			return `presence_${crypto.randomUUID()}`;
		}
		return `presence_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	}

	async ensureAlarm() {
		const alarm = await this.controller.storage.getAlarm();
		if (alarm == null) {
			await this.controller.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
		}
	}

	async alarm() {
		const now = Date.now();
		for (const [sessionId, session] of this.sessions.entries()) {
			if (now - session.lastPingAt > PRESENCE_TIMEOUT_MS) {
				this.closeSession(sessionId, 1001, 'Presence timeout');
			}
		}

		if (this.sessions.size > 0) {
			await this.controller.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
		}
	}
}
