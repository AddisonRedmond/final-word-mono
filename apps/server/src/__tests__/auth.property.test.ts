// Feature: websocket-scaffolding, Property 7: Auth token validation
// Validates: Requirements 4.3, 4.4

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { Hono } from 'hono'

// Use a stable container object so the hoisted vi.mock factory can reference it
const authMock = { verifyIdToken: vi.fn() }

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => [{}]),
  cert: vi.fn(() => ({})),
}))

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => authMock),
}))

// Dynamic import AFTER mocks are registered so the module picks up the mocks
const { authMiddleware } = await import('../middleware/auth.js')

function buildApp() {
  const app = new Hono()
  app.use('*', authMiddleware)
  app.get('/', (c) => c.json({ uid: c.get('uid') }))
  return app
}

beforeEach(() => {
  authMock.verifyIdToken.mockReset()
})

// Property 7: Valid token → middleware calls next(); missing/invalid token → returns 401

describe('Property 7: Auth token validation', () => {
  it('for any non-empty string token (mocked as valid), middleware calls next() and sets uid on context', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Exclude chars that would break cookie parsing, and whitespace-only strings
        // (whitespace-only cookie values may be trimmed/normalized by the HTTP layer)
        fc.string({ minLength: 1 }).filter((s) => !s.includes(';') && !s.includes('=') && s.trim().length > 0),
        fc.string({ minLength: 1 }),
        async (token, uid) => {
          authMock.verifyIdToken.mockResolvedValueOnce({ uid })
          const app = buildApp()
          const res = await app.request('/', {
            headers: { cookie: `token=${token}` },
          })
          expect(res.status).toBe(200)
          const body = await res.json()
          expect(body.uid).toBe(uid)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('for any string token (mocked as invalid/throwing), middleware returns 401', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => !s.includes(';') && !s.includes('=')),
        async (token) => {
          authMock.verifyIdToken.mockRejectedValueOnce(new Error('invalid token'))
          const app = buildApp()
          const res = await app.request('/', {
            headers: { cookie: `token=${token}` },
          })
          expect(res.status).toBe(401)
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('Unit tests: auth middleware', () => {
  it('missing token cookie → returns 401 immediately (no verifyIdToken call)', async () => {
    const app = buildApp()
    const res = await app.request('/')
    expect(res.status).toBe(401)
    expect(authMock.verifyIdToken).not.toHaveBeenCalled()
  })

  it('valid token cookie → next() is called and uid is set', async () => {
    authMock.verifyIdToken.mockResolvedValueOnce({ uid: 'user-123' })
    const app = buildApp()
    const res = await app.request('/', {
      headers: { cookie: 'token=valid-token-abc' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uid).toBe('user-123')
    expect(authMock.verifyIdToken).toHaveBeenCalledWith('valid-token-abc')
  })
})
