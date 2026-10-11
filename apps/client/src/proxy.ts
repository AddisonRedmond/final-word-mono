import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Explicit list of routes the auth proxy runs on (deliberately NOT a regex
// catch-all — the negative-lookahead matcher is error-prone and keeps breaking
// assets/data, so we enumerate the real pages instead). Every authed page MUST
// appear here, or the server-side sign-in redirect won't run for it (the page's
// client-side useRequireAuth is only a fallback). `/sign-in` is included so a
// logged-in user is bounced away from it. `/roadmap` is intentionally OMITTED:
// it's the public "what's coming" page and should stay reachable without login.
//
// NOTE: when you add a new authed page under src/pages, add its route here too.
export const config = {
  matcher: [
    "/",
    "/duels",
    "/friends",
    "/leaderboard",
    "/profile",
    "/sign-in",
    "/stats",
  ],
};
