import { friendships } from '../db/schema.js';

export function resolveFriendshipPair(userOne, userTwo) {
	if (!userOne || !userTwo || userOne === userTwo) {
		return null;
	}

	return userOne < userTwo
		? { userA: userOne, userB: userTwo }
		: { userA: userTwo, userB: userOne };
}

export async function createFriendshipPair(db, userId, friendId) {
	const pair = resolveFriendshipPair(userId, friendId);
	if (!pair) return;

	const now = new Date();

	await db
		.insert(friendships)
		.values({ userA: pair.userA, userB: pair.userB, createdAt: now })
		.onConflictDoNothing();
}
