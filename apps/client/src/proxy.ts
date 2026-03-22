import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authMiddleware, redirectToHome, redirectToLogin } from "next-firebase-auth-edge";
import { env } from "@/env";

const PUBLIC_PATHS = ["/sign-in"];

export default async function proxy(request: NextRequest) {
  return authMiddleware(request, {
    loginPath: "/api/login",
    logoutPath: "/api/logout",
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    cookieName: "AuthToken",
    cookieSignatureKeys: [
      "4137b0a9b857d4c5603e1d9d46a50822efa3c75e0d162cb1271c64dafddc2715",
      "6465ef73537c241eee6fdf851ef091706fa12b746c8b201cb9f0383baa9a386e",
    ],
    cookieSerializeOptions: {
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "lax" as const,
      maxAge: 12 * 60 * 60 * 24,
    },
    serviceAccount: {
      projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    },
    handleValidToken: async ({ token, decodedToken }, headers) => {
      if (PUBLIC_PATHS.includes(request.nextUrl.pathname)) {
        return redirectToHome(request);
      }
      return NextResponse.next({ request: { headers } });
    },
    handleInvalidToken: async (reason) => {
      console.info("Missing or malformed credentials", { reason });
      return redirectToLogin(request, {
        path: "/sign-in",
        publicPaths: PUBLIC_PATHS,
      });
    },
    handleError: async (error) => {
      console.error("Unhandled authentication error", { error });
      return redirectToLogin(request, {
        path: "/sign-in",
        publicPaths: PUBLIC_PATHS,
      });
    },
  });
}

export const config = {
  matcher: [
    "/api/login",
    "/api/logout",
    "/",
    "/sign-in",
    "/((?!_next|favicon.ico|api|.*\\.).*)",
  ],
};