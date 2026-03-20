import { authMiddleware } from 'next-firebase-auth-edge'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Handles the redirect logic for unauthenticated requests (invalid/missing token).
 * - If pathname !== '/sign-in': redirect to '/sign-in'
 * - If pathname === '/sign-in': return NextResponse.next()
 */
export function handleInvalidTokenRedirect(pathname: string, requestUrl: string): NextResponse {
  if (pathname !== '/sign-in') {
    return NextResponse.redirect(new URL('/sign-in', requestUrl))
  }
  return NextResponse.next()
}

/**
 * Handles the redirect logic for authenticated requests (valid token).
 * - If pathname === '/sign-in': redirect to '/'
 * - Otherwise: return NextResponse.next() with forwarded headers
 */
export function handleValidTokenRedirect(pathname: string, requestUrl: string, headers: Headers): NextResponse {
  if (pathname === '/sign-in') {
    return NextResponse.redirect(new URL('/', requestUrl))
  }
  return NextResponse.next({ request: { headers } })
}

export function middleware(request: NextRequest) {
  return authMiddleware(request, {
    loginPath: '/api/login',
    logoutPath: '/api/logout',
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    cookieName: 'session',
    cookieSignatureKeys: [
      process.env.COOKIE_SIGNATURE_KEY_CURRENT!,
      process.env.COOKIE_SIGNATURE_KEY_PREVIOUS!,
    ],
    cookieSerializeOptions: {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 12 * 60 * 60,
    },
    serviceAccount: {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
    handleValidToken: async (_tokens, headers) => {
      return handleValidTokenRedirect(request.nextUrl.pathname, request.url, headers)
    },
    handleInvalidToken: async (_reason) => {
      return handleInvalidTokenRedirect(request.nextUrl.pathname, request.url)
    },
    handleError: async (_error) => {
      return handleInvalidTokenRedirect(request.nextUrl.pathname, request.url)
    },
  })
}

export const config = {
  matcher: ['/api/login', '/api/logout', '/', '/((?!_next|favicon.ico|.*\\..*).*)',],
}
