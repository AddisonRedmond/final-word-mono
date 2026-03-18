import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import superjson from "superjson";
import { ZodError } from "zod";
import { adminAuth } from "@/utils/firebase/server";
import type { DecodedIdToken } from "firebase-admin/auth";

// 1. Add user to context type
type CreateContextOptions = {
  user: DecodedIdToken | null;
};

const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    user: opts.user,
  };
};

// 2. Extract & verify token in the real context
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const token = opts.req.headers.authorization?.split("Bearer ")[1];

  let user: DecodedIdToken | null = null;
  if (token) {
    try {
      user = await adminAuth.verifyIdToken(token);
    } catch {
      // Invalid/expired token — treat as unauthenticated
    }
  }

  return createInnerTRPCContext({ user });
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  console.log(`[TRPC] ${path} took ${Date.now() - start}ms to execute`);
  return result;
});

// 3. Auth middleware
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { user: ctx.user }, // narrows user from `DecodedIdToken | null` to `DecodedIdToken`
  });
});

// Unchanged — open to anyone
export const publicProcedure = t.procedure.use(timingMiddleware);

// New — throws 401 if no valid token
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(isAuthed);
