import { Hono } from 'hono';
import profileRouter from './profile.js';
import statsRouter from './stats.js';
import locationsRouter from './locations.js';
import socialRouter from './social.js';
import invitesRouter from './invites.js';

const userRouter = new Hono();

userRouter.route('/', profileRouter);
userRouter.route('/', statsRouter);
userRouter.route('/', locationsRouter);
userRouter.route('/', socialRouter);
userRouter.route('/', invitesRouter);

export default userRouter;
