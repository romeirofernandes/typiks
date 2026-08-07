import { describe, expect, it } from 'vitest';
import {
	generateGuestEmail,
	generateGuestUsername,
	getGuestUidFromEmail,
	isGuestEmail,
} from '../src/utils/guest.js';

describe('guest identity helpers', () => {
	it('builds a synthetic email unique to the uid', () => {
		const email = generateGuestEmail('abc123');
		expect(email).toBe('guest-abc123@guest.typiks');
		expect(generateGuestEmail('abc123')).toBe(generateGuestEmail('abc123'));
		expect(generateGuestEmail('abc123')).not.toBe(generateGuestEmail('def456'));
	});

	it('recognizes synthetic guest emails and rejects real ones', () => {
		expect(isGuestEmail('guest-abc123@guest.typiks')).toBe(true);
		expect(isGuestEmail('GUEST-ABC123@GUEST.TYPIKS')).toBe(true);
		expect(isGuestEmail('player@example.com')).toBe(false);
		expect(isGuestEmail(null)).toBe(false);
		expect(isGuestEmail(undefined)).toBe(false);
	});

	it('round-trips a uid through the synthetic email', () => {
		expect(getGuestUidFromEmail('guest-abc123@guest.typiks')).toBe('abc123');
		expect(getGuestUidFromEmail('player@example.com')).toBeNull();
		expect(getGuestUidFromEmail(null)).toBeNull();
	});

	it('generates unique-looking usernames in AdjectiveAnimalN suffix form', () => {
		const seen = new Set();
		for (let i = 0; i < 200; i++) {
			const username = generateGuestUsername();
			expect(username).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
			seen.add(username);
		}
		expect(seen.size).toBeGreaterThan(150);
	});
});
