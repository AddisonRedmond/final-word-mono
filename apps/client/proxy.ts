// middleware.ts (project root, next to package.json)
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/utils/firebase/server";

const PUBLIC_ROUTES = ["/", "/login", "/signup"];
const AUTH_ROUTES = ["/login", "/signup"]; // redirect away if already logged in

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("firebase-token")?.value;

  // Verify token if present
  let user = null;
  if (token) {
    try {
      user = await adminAuth.verifyIdToken(token);
    } catch {
      // Invalid/expired token — clear the cookie and treat as logged out
      const res = NextResponse.redirect(new URL("/login", req.url));
      res.cookies.delete("firebase-token");
      return res;
    }
  }

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  // Logged-in user trying to access login/signup — send to app
  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Logged-out user trying to access a protected route — send to login
  if (!user && !isPublicRoute) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname); // preserve intended destination
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all routes EXCEPT:
     * - _next/static  (static files)
     * - _next/image   (image optimization)
     * - favicon.ico
     * - public folder assets (png, jpg, svg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
