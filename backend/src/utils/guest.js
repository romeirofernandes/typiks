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

export function generateGuestUsername() {
	const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
	const suffix = Math.floor(Math.random() * 90) + 10;
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
