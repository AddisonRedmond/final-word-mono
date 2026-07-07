import { createServerClient } from "@supabase/ssr";
import { env } from "@/env";
import type { NextApiRequest, NextApiResponse } from "next";

// Pages Router / tRPC compatible SSR client
export function createSupabaseServerClient(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return createSupabaseApiRouteClient(req, res);
}

// Pages Router API route client (reads/writes cookies from req/res)
export function createSupabaseApiRouteClient(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return Object.entries(req.cookies)
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => ({ name, value: value! }));
        },
        setAll(cookiesToSet) {
          const existing = res.getHeader("Set-Cookie");
          const cookieHeader: string[] = Array.isArray(existing)
            ? existing.map(String)
            : existing
              ? [String(existing)]
              : [];

          cookiesToSet.forEach(({ name, value, options = {} }) => {
            const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
            if (options.path) parts.push(`Path=${options.path}`);
            if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
            if (options.domain) parts.push(`Domain=${options.domain}`);
            if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
            if (options.httpOnly) parts.push("HttpOnly");
            if (options.secure) parts.push("Secure");
            if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
            cookieHeader.push(parts.join("; "));
          });

          res.setHeader("Set-Cookie", cookieHeader);
        },
      },
    },
  );
}
