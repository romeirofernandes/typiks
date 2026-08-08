function log(level, message, meta = {}) {
	const record = {
		level,
		message,
		ts: new Date().toISOString(),
		...meta,
	};
	if (level === 'error') {
		console.error(JSON.stringify(record));
	} else if (level === 'warn') {
		console.warn(JSON.stringify(record));
	} else {
		console.log(JSON.stringify(record));
	}
}

export const logger = {
	info(message, meta) {
		log('info', message, meta);
	},
	warn(message, meta) {
		log('warn', message, meta);
	},
	error(message, meta) {
		log('error', message, meta);
	},
};
