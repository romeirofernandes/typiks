import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { friendRequests, friendships, users } from '../../db/schema.js';
import { requireFirebaseAuth } from '../../middleware/firebaseAuth.js';
import { createFriendshipPair, resolveFriendshipPair } from '../../services/friendships.js';
import { buildOnlineMapWithPresence, notifyUser } from '../../services/presence.js';
import { normalizeUsername } from '../../services/validation.js';
import { generateEntityId } from '../../services/ids.js';
import {
	FRIEND_REQUEST_ACCEPTED,
	FRIEND_REQUEST_PENDING,
	FRIEND_REQUEST_REJECTED,
} from '../../config.js';
import { logger } from '../../services/logger.js';

const socialRouter = new Hono();
const requireAuth = requireFirebaseAuth();

socialRouter.get('/me/friends', requireAuth, async (c) => {
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
		logger.error('Failed to fetch friends', { error: error?.message });
		return c.json({ error: 'Failed to fetch friends' }, 500);
	}
});

socialRouter.get('/me/friend-requests', requireAuth, async (c) => {
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
		logger.error('Failed to fetch friend requests', { error: error?.message });
		return c.json({ error: 'Failed to fetch friend requests' }, 500);
	}
});

socialRouter.patch('/me/presence', requireAuth, async (c) => {
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
		logger.error('Failed to update presence', { error: error?.message });
		return c.json({ error: 'Failed to update presence' }, 500);
	}
});

socialRouter.get('/me/search', requireAuth, async (c) => {
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
		logger.error('Failed to search users', { error: error?.message });
		return c.json({ error: 'Failed to search users' }, 500);
	}
});

socialRouter.post('/me/friend-requests', requireAuth, async (c) => {
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

		c.executionCtx.waitUntil(notifyUser(c.env, receiverId, { kind: 'friend-request' }));

		return c.json({
			message: 'Friend request sent',
			request: {
				id: requestId,
				receiverId,
				receiverUsername: target[0].username,
			},
		});
	} catch (error) {
		logger.error('Failed to send friend request', { error: error?.message });
		return c.json({ error: 'Failed to send friend request' }, 500);
	}
});

socialRouter.patch('/me/friend-requests/:requestId', requireAuth, async (c) => {
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
		logger.error('Failed to handle friend request', { error: error?.message });
		return c.json({ error: 'Failed to handle friend request' }, 500);
	}
});

socialRouter.delete('/me/friends/:friendId', requireAuth, async (c) => {
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
		logger.error('Failed to remove friend', { error: error?.message });
		return c.json({ error: 'Failed to remove friend' }, 500);
	}
});

export default socialRouter;
