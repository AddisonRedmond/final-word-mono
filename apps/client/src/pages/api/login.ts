import { adminAuth } from "@/utils/firebase/server";
import type { NextApiRequest, NextApiResponse } from "next";

const COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours in seconds

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end();

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "Missing token" });

  try {
    await adminAuth.verifyIdToken(token);

    const expires = new Date(Date.now() + COOKIE_MAX_AGE * 1000);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

    res.setHeader(
      "Set-Cookie",
      `session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`,
    );

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(401).json({ error: "Invalid token" });
  }
}
