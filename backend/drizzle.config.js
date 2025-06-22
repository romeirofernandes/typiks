export default {
	schema: './src/db/schema.js',
	out: './migrations',
	driver: 'd1',
	dbCredentials: {
		wranglerConfigPath: './wrangler.jsonc',
		dbName: 'typiks',
	},
};
