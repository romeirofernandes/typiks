import { Hono } from "hono";
import {drizzle } from "drizzle-orm/d1";
import {eq} from 'drizzle-orm';
import {users} from '../db/schema';

const userRouter = new Hono()

userRouter.post('/', async(c)=> {
    try{
        const db = drizzle.apply(c.env.DB);
        const body = await c.req.json();

        const existingUser = await db.select().from(users).where(eq(users.id, uid)).limit(1);

        if(existingUser.length > 0) {
            return c.json({user: existingUser[0], message: 'User already exists'});
        }

        const newUser = await db.insert(users).values({id: uid, username, email, gamesPlayed: 0, gamesWon:0, gamesLost: 0, createdAt: new Date()}).returning();

        return c.json({user: newUser[0], message: 'User created successfully'}, 200)
    }
    catch(error) {
        return c.json({error: 'Failed to create user', details: error.message}, 500);
    }
})

userRouter.get('/:id', async (c)=> {
    try {
        const db = drizzle(c.env.DB)
        const uid = c.req.param('id');

        const user = await db.select().from(users).where(eq(users.id, uid)).limit(1)

        if(users.length === 0 ){
            return c.json({error: 'User not found'}, 404)
        }

        return c.json({user: user[0]}, 200)
    }
    catch(error) {
        return c.json ({error: 'Failed to fetch user'}, 500)
    }
})

userRouter.patch('/:id/stats', async (c)=> {
    try {
        const db = drizzle(c.env.DB)
        const uid = c.req.param('id')
        const {won} = await c.req.json();

        const user = await db.select().from(users).where(eq(users.id, uid)).limit(1)

        if(user.length === 0 ){
            return c.json({error: 'User not found'}, 404)
        }

        const updatedUser = await db.update(users).set({
            gamesPlayed: user[0].gamesPlayed + 1,
            gamesWon: won ? user[0].gamesWon + 1 : user[0].gamesWon,
            gamesLost: !won ? user[0].gamesLost + 1 : user[0].gamesLost,
        }).where(eq(users.id, uid)).returning();

        return c.json ({user: updatedUser[0]}, 200)
    }
    catch(error) {
        return c.json({error: "Failed to update stats."}, 500)
    }
})

userRouter.get('/:id/stats', async (c)=> {
    try {
        const db = drizzle(c.env.DB)
        const uid = c.req.param('id')

        const user = await db.select({
            username: users.username,
            gamesPlayed: users.gamesPlayed,
            gamesWon: users.gamesWon,
            gamesLost: users.gamesLost,
        }).from(users).where(eq(users.id, uid)).limit(1);

        if(user.length === 0 ){
            return c.json({error: "User not found"});
        }

        const stats = user[0]
        const winRate = stats.gamesPlayed > 0 ? (stats.gamesWon / stats.gamesPlayed * 100).toFixed(1) : 0;

        return c.json ({
            ...stats,
             winRate: parseFloat(winRate)
        })
    }
    catch (error) {
        return c.json ({error: 'Failed to fetch stats'}, 500)
    }
})

export default userRouter