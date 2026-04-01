function resolveActualScore(result) {
	if (typeof result === 'number' && result >= 0 && result <= 1) {
		return result;
	}

	if (typeof result === 'boolean') {
		return result ? 1 : 0;
	}

	return 0;
}

function resolveKFactor(rating, gamesPlayed = 0) {
	if (gamesPlayed < 30) {
		return 40;
	}

	if (rating >= 2400) {
		return 10;
	}

	return 20;
}

// Elo variant used in large competitive platforms with dynamic K-factor.
export function calculateNewRatings(playerRating, opponentRating, result, options = {}) {
	const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
	const actualScore = resolveActualScore(result);
	const kFactor = resolveKFactor(playerRating, options.gamesPlayed ?? 0);

	return Math.round(playerRating + kFactor * (actualScore - expectedScore));
}

export function getRatingChange(oldRating, newRating) {
	return newRating - oldRating;
}
