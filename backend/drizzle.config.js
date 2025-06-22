export default {
	schema: './src/db/schema.js',
	out: './migrations',
	dialect: 'sqlite',
	driver: 'd1-http',
	dbCredentials: {
		wranglerConfigPath: './wrangler.jsonc',
		dbName: 'typiks',
	},
};
