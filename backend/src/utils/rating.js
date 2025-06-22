// Chess.com style ELO rating system
export function calculateNewRatings(playerRating, opponentRating, playerWon) {
	const K = 32; // K-factor (how much rating changes per game)

	// Expected score for player
	const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));

	// Actual score (1 for win, 0 for loss)
	const actualScore = playerWon ? 1 : 0;

	// New rating calculation
	const newRating = Math.round(playerRating + K * (actualScore - expectedScore));

	return newRating;
}

export function getRatingChange(oldRating, newRating) {
	return newRating - oldRating;
}
