import rankedWordsRaw from '../../../words.json' with { type: 'json' };

export const WORD_DIFFICULTIES = /** @type {const} */ ({
	easy: 'easy',
	medium: 'medium',
	hard: 'hard',
});

function createMulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
	};
}

function sanitizeDifficulty(difficulty) {
	if (difficulty === WORD_DIFFICULTIES.easy) return WORD_DIFFICULTIES.easy;
	if (difficulty === WORD_DIFFICULTIES.medium) return WORD_DIFFICULTIES.medium;
	if (difficulty === WORD_DIFFICULTIES.hard) return WORD_DIFFICULTIES.hard;
	return WORD_DIFFICULTIES.medium;
}

function sanitizeWords(words) {
	const seen = new Set();
	/** @type {string[]} */
	const out = [];

	for (const raw of words) {
		if (typeof raw !== 'string') continue;
		const word = raw.trim().toLowerCase();
		if (!word) continue;
		if (seen.has(word)) continue;
		seen.add(word);
		out.push(word);
	}

	return out;
}

function buildBuckets(words) {
	/** @type {string[]} */
	const easy = [];
	/** @type {string[]} */
	const medium = [];
	/** @type {string[]} */
	const hard = [];

	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		const len = word.length;

		if (len <= 4 && i < 6000) {
			easy.push(word);
			continue;
		}
		if (len >= 5 && len <= 7 && i < 9000) {
			medium.push(word);
			continue;
		}
		hard.push(word);
	}

	return { all: words, easy, medium, hard };
}

const WORDS = sanitizeWords(rankedWordsRaw);
const BUCKETS = buildBuckets(WORDS);

function pickBucket(difficulty) {
	const safeDifficulty = sanitizeDifficulty(difficulty);
	if (safeDifficulty === WORD_DIFFICULTIES.easy) return BUCKETS.easy;
	if (safeDifficulty === WORD_DIFFICULTIES.medium) return BUCKETS.medium;
	return BUCKETS.hard;
}

function sampleWeightedWithoutReplacement(bucket, rng, count) {
	const candidates = bucket.map((word, idx) => ({
		word,
		weight: Math.max(1, bucket.length - idx),
	}));

	/** @type {string[]} */
	const selected = [];
	const picks = Math.min(count, candidates.length);

	for (let p = 0; p < picks; p++) {
		let totalWeight = 0;
		for (let i = 0; i < candidates.length; i++) totalWeight += candidates[i].weight;
		if (totalWeight <= 0) break;

		let r = Math.floor(rng() * totalWeight);
		let chosenIndex = 0;
		for (let i = 0; i < candidates.length; i++) {
			r -= candidates[i].weight;
			if (r < 0) {
				chosenIndex = i;
				break;
			}
		}

		selected.push(candidates[chosenIndex].word);
		candidates.splice(chosenIndex, 1);
	}

	return selected;
}

function shuffleInPlace(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = arr[i];
		arr[i] = arr[j];
		arr[j] = tmp;
	}
}

export function generateSeed() {
	try {
		const buf = new Uint32Array(1);
		crypto.getRandomValues(buf);
		return buf[0] >>> 0;
	} catch {
		return Date.now() >>> 0;
	}
}

export function generateWords(seed, difficulty, count = 30) {
	if (!Number.isSafeInteger(count) || count <= 0) {
		throw new Error('count must be a positive integer');
	}
	if (count > 200) {
		throw new Error('count too large');
	}

	const safeSeed = Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 0;
	const rng = createMulberry32(safeSeed ^ 0xa5a5a5a5);

	let bucket = pickBucket(difficulty);
	if (bucket.length < count) {
		bucket = BUCKETS.all;
	}

	const words = sampleWeightedWithoutReplacement(bucket, rng, count);
	shuffleInPlace(words, rng);
	return words;
}
