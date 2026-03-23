import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import type { Context, Next } from 'hono'

const app =
  getApps()[0] ??
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })

export const adminAuth = getAuth(app)

export async function authMiddleware(c: Context, next: Next) {
  const cookie = c.req.header('cookie') ?? ''
  const token = cookie
    .split(';')
    .find((s) => s.trim().startsWith('token='))
    ?.split('=')[1]

  if (!token) return c.text('unauthorized', 401)

  try {
    const decoded = await adminAuth.verifyIdToken(token)
    c.set('uid', decoded.uid)
    await next()
  } catch {
    return c.text('unauthorized', 401)
  }
}
