const ADJECTIVES = [
	'Swift',
	'Quick',
	'Bold',
	'Fierce',
	'Clever',
	'Lucky',
	'Zippy',
	'Daring',
	'Jolly',
	'Turbo',
	'Rapid',
	'Chill',
	'Ninja',
	'Cosmic',
	'Neon',
	'Pixel',
	'Savage',
	'Smoky',
	'Frosty',
	'Golden',
];

const ANIMALS = [
	'Fox',
	'Tiger',
	'Hawk',
	'Wolf',
	'Falcon',
	'Panther',
	'Cheetah',
	'Dragon',
	'Lynx',
	'Otter',
	'Panda',
	'Rabbit',
	'Koala',
	'Lion',
	'Owl',
	'Shark',
	'Viper',
	'Whale',
	'Cobra',
	'Zebra',
];

function randomIndex(length) {
	if (length <= 0) return 0;
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const value = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
	return value % length;
}

export function generateGuestUsername() {
	const adjective = ADJECTIVES[randomIndex(ADJECTIVES.length)];
	const animal = ANIMALS[randomIndex(ANIMALS.length)];
	const suffix = randomIndex(90) + 10;
	return `${adjective}${animal}${suffix}`;
}

const GUEST_EMAIL_DOMAIN = 'guest.typiks';
const GUEST_EMAIL_PATTERN = new RegExp(`^guest-(.+)@${GUEST_EMAIL_DOMAIN}$`, 'i');

export function generateGuestEmail(uid) {
	return `guest-${uid}@${GUEST_EMAIL_DOMAIN}`;
}

export function isGuestEmail(email) {
	return typeof email === 'string' && GUEST_EMAIL_PATTERN.test(email);
}

export function getGuestUidFromEmail(email) {
	const match = typeof email === 'string' ? email.match(GUEST_EMAIL_PATTERN) : null;
	return match ? match[1] : null;
}
