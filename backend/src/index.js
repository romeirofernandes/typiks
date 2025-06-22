import { Hono } from "hono";
import {cors} from "hono/cors";
import userRouter from './routes/users.js'

const app = new Hono();

app.use('*', cors({
	origin: ['http://localhost:5173'],
	credentials: true,
}));

app.get('/', (c)=> {
	return c.text('Server is healthy.')
});

app.route('/api/users', userRouter)

export default app;