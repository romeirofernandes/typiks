import { describe, expect, it } from 'vitest';
import { computeRankedOutcome, matchRatingsDto } from '../src/services/match-results.js';

const PLAYER_MODE = { rating: 800, gamesPlayed: 5 };
const OPPONENT_MODE = { rating: 800, gamesPlayed: 15 };

describe('computeRankedOutcome', () => {
	it('awards the expected rating swing on a win', () => {
		const outcome = computeRankedOutcome(PLAYER_MODE, OPPONENT_MODE, {
			playerWon: true,
			isDraw: false,
		});

		expect(outcome.playerRating).toBe(820);
		expect(outcome.opponentRating).toBe(780);
		expect(outcome.playerRatingChange).toBe(20);
		expect(outcome.opponentRatingChange).toBe(-20);
	});

	it('awards the expected rating swing on a loss', () => {
		const outcome = computeRankedOutcome(PLAYER_MODE, OPPONENT_MODE, {
			playerWon: false,
			isDraw: false,
		});

		expect(outcome.playerRating).toBe(780);
		expect(outcome.opponentRating).toBe(820);
	});

	it('splits the swing on a draw', () => {
		const outcome = computeRankedOutcome(PLAYER_MODE, OPPONENT_MODE, {
			playerWon: false,
			isDraw: true,
		});

		expect(outcome.playerRating).toBe(800);
		expect(outcome.opponentRating).toBe(800);
	});

	it('uses a smaller K-factor for experienced players above 2400', () => {
		const expert = { rating: 2500, gamesPlayed: 100 };
		const opponent = { rating: 2400, gamesPlayed: 100 };

		const outcome = computeRankedOutcome(expert, opponent, {
			playerWon: true,
			isDraw: false,
		});

		expect(outcome.playerRating).toBe(2504);
		expect(outcome.opponentRating).toBe(2396);
	});
});

describe('matchRatingsDto', () => {
	it('shapes ratings keyed by player slot', () => {
		const dto = matchRatingsDto(
			{
				player1: { ratingBefore: 800, ratingAfter: 820, ratingChange: 20 },
				player2: { ratingBefore: 800, ratingAfter: 780, ratingChange: -20 },
			},
			'user-1',
			'user-2'
		);

		expect(dto).toEqual({
			player1: { id: 'user-1', ratingBefore: 800, ratingAfter: 820, ratingChange: 20 },
			player2: { id: 'user-2', ratingBefore: 800, ratingAfter: 780, ratingChange: -20 },
		});
	});
});