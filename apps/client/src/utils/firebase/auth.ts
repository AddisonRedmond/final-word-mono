// lib/firebase/verifyToken.ts

import { adminAuth } from "./server";

export async function verifyToken(token: string | undefined) {
  if (!token) throw new Error("No token provided");
  return adminAuth.verifyIdToken(token); // throws if invalid/expired
}
