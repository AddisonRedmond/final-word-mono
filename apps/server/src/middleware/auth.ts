import type { Context, Next } from "hono";
import { adminAuth } from "../../../../packages/firebase/server.js";

export async function authMiddleware(c: Context, next: Next) {
  const cookie = c.req.header("cookie") ?? "";
  const token = cookie
    .split(";")
    .find((s) => s.trim().startsWith("token="))
    ?.split("=")[1];

  if (!token) return c.text("unauthorized", 401);

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    c.set("uid", decoded.uid);
    await next();
  } catch {
    return c.text("unauthorized", 401);
  }
}
