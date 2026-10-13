import { billingRouter } from "@/server/api/routers/billing";
import { friendsRouter } from "@/server/api/routers/friends";
import { leaderboardRouter } from "@/server/api/routers/leaderboard";
import { profileRouter } from "@/server/api/routers/profile";
import { statsRouter } from "@/server/api/routers/stats";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { duelsRouter } from "./routers/duels";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	friends: friendsRouter,
	duels: duelsRouter,
	billing: billingRouter,
	stats: statsRouter,
	leaderboard: leaderboardRouter,
	profile: profileRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
