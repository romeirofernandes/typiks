import { verifyFirebaseIdToken } from '../middleware/firebaseAuth.js';
import { generateEntityId as createId } from '../services/ids.js';

// WSCoordinator is the shared WebSocket + session + auth machinery every
// Durable Object coordinator uses. The trio that used to be copy-pasted four
// times — message parsing, socket-open detection, and Firebase authentication —
// lives here once, together with the session bookkeeping (sessions /
// sessionOrder / playerToSession), the upgrade handshake, and the supersede
// logic for reconnects.
//
// Subclasses own the domain: they implement handleMessage() to dispatch on
// message.type, and override handlePlayerDisconnect() / registerSession() /
// getSocket() / generateSessionId() where their session model differs (e.g.
// PresenceHub tracks per-session records, not bare sockets).
export class WSCoordinator {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.storage = state?.storage ?? null;

		// Ephemeral connection state. Persisted lifecycle state lives in the
		// subclass; only the socket maps are shared here.
		this.sessions = new Map(); // sessionId -> WebSocket (or session record)
		this.sessionOrder = new Map(); // sessionId -> monotonic connection order
		this.playerToSession = new Map(); // playerId -> sessionId
		this.nextSessionOrder = 0;
	}

	jsonResponse(body, status = 200) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	async authenticateAndGetPlayerId(message) {
		const idToken = message?.idToken;
		if (typeof idToken !== 'string' || idToken.length === 0) {
			throw new Error('Missing idToken');
		}
		const claims = await verifyFirebaseIdToken(idToken, {
			projectId: this.env.FIREBASE_PROJECT_ID,
		});
		return claims.uid;
	}

	parseMessage(data) {
		if (typeof data !== 'string') return null;

		try {
			const parsed = JSON.parse(data);
			if (!parsed || typeof parsed !== 'object') {
				return null;
			}
			return parsed;
		} catch {
			return null;
		}
	}

	isSocketOpen(webSocket) {
		if (!webSocket) return false;

		const openStates = [WebSocket.OPEN, WebSocket.READY_STATE_OPEN, 1].filter((state) =>
			Number.isFinite(state)
		);
		return openStates.includes(webSocket.readyState);
	}

	generateSessionId() {
		return createId('session');
	}

	registerSession(sessionId, webSocket) {
		this.sessions.set(sessionId, webSocket);
		this.sessionOrder.set(sessionId, this.nextSessionOrder++);
	}

	getSocket(sessionId) {
		return this.sessions.get(sessionId) ?? null;
	}

	sendToPlayer(sessionId, message) {
		if (typeof sessionId !== 'string' || sessionId.length === 0) {
			return;
		}

		const webSocket = this.getSocket(sessionId);
		if (this.isSocketOpen(webSocket)) {
			try {
				webSocket.send(JSON.stringify(message));
			} catch (error) {
				console.error('Error sending message:', error);
			}
		}
	}

	closeSession(sessionId, code = 1000, reason = 'Session replaced') {
		const previousSocket = this.sessions.get(sessionId);
		if (!previousSocket) {
			return;
		}

		try {
			previousSocket.close(code, reason);
		} catch {
			// ignore close errors from stale sockets
		}

		this.sessions.delete(sessionId);
		this.sessionOrder.delete(sessionId);
	}

	getSessionOrder(sessionId) {
		return this.sessionOrder.get(sessionId) ?? -1;
	}

	// Claims playerId's session after applying the reconnect supersede rule:
	// a newer session replaces the older one; an older session may not steal
	// the player back. Returns false when the caller should stop handling this
	// join (this socket was closed as superseded).
	claimSession(playerId, sessionId) {
		const previousSessionId = this.playerToSession.get(playerId);
		if (
			previousSessionId &&
			previousSessionId !== sessionId &&
			this.getSessionOrder(previousSessionId) > this.getSessionOrder(sessionId)
		) {
			this.closeSession(sessionId, 1000, 'Superseded by newer session');
			return false;
		}

		if (previousSessionId && previousSessionId !== sessionId) {
			this.closeSession(previousSessionId, 1000, 'Replaced by newer session');
		}

		this.playerToSession.set(playerId, sessionId);
		return true;
	}

	handleSessionTermination(sessionId, playerId) {
		this.sessions.delete(sessionId);
		this.sessionOrder.delete(sessionId);

		if (!playerId) {
			return;
		}

		const ownedSessionId = this.playerToSession.get(playerId);
		if (ownedSessionId !== sessionId) {
			return;
		}

		this.playerToSession.delete(playerId);
		this.handlePlayerDisconnect(playerId);
	}

	// Default hook: no shared disconnect behaviour. GameRoom finalizes a
	// running round, PrivateRoom runs handlePlayerLeave, MatchmakingRoom
	// removes the waiting player.
	handlePlayerDisconnect(_playerId) {}

	handleSession(webSocket, request) {
		webSocket.accept();

		const sessionId = this.generateSessionId();
		this.registerSession(sessionId, webSocket);

		let playerId = null;

		webSocket.addEventListener('message', async (event) => {
			try {
				const message = this.parseMessage(event.data);
				if (!message || typeof message.type !== 'string') {
					return;
				}

				await this.handleMessage(message, {
					sessionId,
					webSocket,
					request,
					getPlayerId: () => playerId,
					setPlayerId: (id) => {
						playerId = id;
					},
				});
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
			}
		});

		webSocket.addEventListener('close', () => {
			this.handleSessionTermination(sessionId, playerId);
		});

		webSocket.addEventListener('error', (error) => {
			console.error('WebSocket error:', error);
			this.handleSessionTermination(sessionId, playerId);
		});
	}

	// Subclasses implement the domain dispatch switch. The context carries the
	// session id/socket/request plus a mutable playerId binding so a JOIN that
	// authenticates can stamp the connection with the player id.
	async handleMessage(_message, _ctx) {}
}
