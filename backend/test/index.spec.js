import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Typiks worker', () => {
	it('responds with API welcome text (unit style)', async () => {
		const request = new Request('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('Typiks Backend API');
	});

	it('rejects non-websocket calls to /ws (integration style)', async () => {
		const response = await SELF.fetch('http://example.com/ws');
		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Expected websocket');
	});

	it('responds with API welcome text (integration style)', async () => {
		const response = await SELF.fetch('http://example.com');
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('Typiks Backend API');
	});
});
