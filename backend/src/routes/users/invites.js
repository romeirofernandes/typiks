import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { friendRequests, friendships, roomInvites, users } from '../../db/schema.js';
import { requireFirebaseAuth } from '../../middleware/firebaseAuth.js';
import { resolveFriendshipPair } from '../../services/friendships.js';
import { buildOnlineMapWithPresence, notifyUser } from '../../services/presence.js';
import { normalizeRoomCode } from '../../services/validation.js';
import { generateEntityId } from '../../services/ids.js';
import {
	FRIEND_REQUEST_PENDING,
	ROOM_INVITE_ACCEPTED,
	ROOM_INVITE_PENDING,
	ROOM_INVITE_REJECTED,
} from '../../config.js';
import { logger } from '../../services/logger.js';

const invitesRouter = new Hono();
const requireAuth = requireFirebaseAuth();

invitesRouter.get('/me/room-invites', requireAuth, async (c) => {
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
				inviterAvatarId: inviterUser.avatarId,
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
		logger.error('Failed to fetch room invites', { error: error?.message });
		return c.json({ error: 'Failed to fetch room invites' }, 500);
	}
});

invitesRouter.post('/me/room-invites', requireAuth, async (c) => {
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

		c.executionCtx.waitUntil(notifyUser(c.env, inviteeId, { kind: 'room-invite' }));

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
		logger.error('Failed to send room invite', { error: error?.message });
		return c.json({ error: 'Failed to send room invite' }, 500);
	}
});

invitesRouter.patch('/me/room-invites/:inviteId', requireAuth, async (c) => {
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
		logger.error('Failed to respond to room invite', { error: error?.message });
		return c.json({ error: 'Failed to respond to room invite' }, 500);
	}
});

invitesRouter.get('/me/notifications', requireAuth, async (c) => {
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
		logger.error('Failed to fetch notifications', { error: error?.message });
		return c.json({ error: 'Failed to fetch notifications' }, 500);
	}
});

export default invitesRouter;
