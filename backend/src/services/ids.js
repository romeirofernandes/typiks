export function generateEntityId(prefix) {
	if (typeof crypto?.randomUUID === 'function') {
		return `${prefix}_${crypto.randomUUID()}`;
	}

	// Fallback for runtimes without randomUUID. Workers with nodejs_compat
	// expose crypto.randomUUID, so this path is purely defensive.
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${prefix}_${hex.slice(0, 8)}_${hex.slice(8, 12)}_${hex.slice(12, 16)}`;
}

export function randomSuffix(length = 4) {
	const bytes = new Uint8Array(Math.ceil(length / 2));
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return hex.slice(0, length);
}
