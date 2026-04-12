import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { computeFeedback, dispatchAttack } from '../ws/gameEngine.js'
import type { AttackQueue } from '../ws/gameEngine.js'

// Generator for random 5-letter uppercase strings
const fiveLetterWord = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
    minLength: 5,
    maxLength: 5,
  })
  .map((chars) => chars.join(''))

// Generator for a single AttackEntry
const attackEntry = fc.record({
  word: fiveLetterWord,
  revealedPositions: fc
    .array(fc.integer({ min: 0, max: 4 }), { minLength: 0, maxLength: 3 })
    .map((arr) => [...new Set(arr)].sort((a, b) => a - b)),
})

// ─── Property tests: computeFeedback ─────────────────────────────────────────

/**
 * Property 1: Output length is always 5 for any 5-letter input pair
 * Validates: Requirements 3.2
 */
describe('Property 1: Output length is always 5', () => {
  it('computeFeedback always returns an array of length 5', () => {
    fc.assert(
      fc.property(fiveLetterWord, fiveLetterWord, (guess, secret) => {
        const result = computeFeedback(guess, secret)
        expect(result).toHaveLength(5)
      }),
      { numRuns: 200 },
    )
  })
})

/**
 * Property 2: All-correct when guess === secret
 * Validates: Requirements 3.3
 */
describe('Property 2: All-correct when guess equals secret', () => {
  it('computeFeedback returns all "correct" when guess === secret', () => {
    fc.assert(
      fc.property(fiveLetterWord, (word) => {
        const result = computeFeedback(word, word)
        expect(result).toEqual(['correct', 'correct', 'correct', 'correct', 'correct'])
      }),
      { numRuns: 200 },
    )
  })
})

/**
 * Property 3: Correct-position letters are always marked "correct"
 * Validates: Requirements 3.6
 */
describe('Property 3: Correct-position letters are always marked correct', () => {
  it('any position where guess[i] === secret[i] is marked "correct"', () => {
    fc.assert(
      fc.property(fiveLetterWord, fiveLetterWord, (guess, secret) => {
        const result = computeFeedback(guess, secret)
        for (let i = 0; i < 5; i++) {
          if (guess[i] === secret[i]) {
            expect(result[i]).toBe('correct')
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Unit tests: computeFeedback ─────────────────────────────────────────────

describe('computeFeedback unit tests', () => {
  it('"HELLO" vs "HELLO" → all correct', () => {
    expect(computeFeedback('HELLO', 'HELLO')).toEqual([
      'correct', 'correct', 'correct', 'correct', 'correct',
    ])
  })

  it('"CRANE" vs "CRANE" → all correct', () => {
    expect(computeFeedback('CRANE', 'CRANE')).toEqual([
      'correct', 'correct', 'correct', 'correct', 'correct',
    ])
  })

  it('"ABCDE" vs "FGHIJ" → all absent', () => {
    expect(computeFeedback('ABCDE', 'FGHIJ')).toEqual([
      'absent', 'absent', 'absent', 'absent', 'absent',
    ])
  })

  it('duplicate letter handling: "LLAMA" vs "HELLO" — correct positions marked correctly', () => {
    // HELLO: H=0, E=1, L=2, L=3, O=4
    // LLAMA: L=0, L=1, A=2, M=3, A=4
    // pos 0: L vs H → not correct; L is in HELLO at pos 2 or 3 → present
    // pos 1: L vs E → not correct; L still available (pos 3) → present
    // pos 2: A vs L → not correct; A not in HELLO → absent
    // pos 3: M vs L → not correct; M not in HELLO → absent
    // pos 4: A vs O → not correct; A not in HELLO → absent
    const result = computeFeedback('LLAMA', 'HELLO')
    expect(result[0]).toBe('present') // L is in HELLO but wrong position
    expect(result[1]).toBe('present') // second L also matches remaining L in HELLO
    expect(result[2]).toBe('absent')  // A not in HELLO
    expect(result[3]).toBe('absent')  // M not in HELLO
    expect(result[4]).toBe('absent')  // A not in HELLO
  })
})

// ─── Property tests: dispatchAttack ──────────────────────────────────────────

/**
 * Property 4: Queue length never exceeds 4 after any dispatch
 * Validates: Requirements 14.1, 14.2, 14.3
 */
describe('Property 4: Queue length never exceeds 4 after any dispatch', () => {
  it('dispatchAttack always produces a queue of length <= 4', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fiveLetterWord,
        fc.array(attackEntry, { minLength: 0, maxLength: 4 }),
        (guessCount, word, queue) => {
          const { updatedQueue } = dispatchAttack(guessCount, word, queue as AttackQueue)
          expect(updatedQueue.length).toBeLessThanOrEqual(4)
        },
      ),
      { numRuns: 200 },
    )
  })
})

/**
 * Property 5: Overflow penalty reduces revealedPositions count by 1 (min 0)
 * Validates: Requirements 14.1, 14.2, 14.3
 */
describe('Property 5: Overflow penalty reduces revealedPositions count by 1 (min 0)', () => {
  it('overflow result has at most (baseline - 1) revealed positions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fiveLetterWord,
        fc.array(attackEntry, { minLength: 3, maxLength: 3 }),
        (guessCount, word, baseQueue) => {
          // Baseline: queue of length 3 (no overflow)
          const { revealedPositions: baseline } = dispatchAttack(
            guessCount,
            word,
            baseQueue as AttackQueue,
          )

          // Build a queue of exactly length 4 by appending one more entry
          const fullQueue: AttackQueue = [
            ...(baseQueue as AttackQueue),
            { word, revealedPositions: baseline },
          ]

          // Overflow dispatch with the same guessCount
          const { revealedPositions: overflowResult } = dispatchAttack(
            guessCount,
            word,
            fullQueue,
          )

          // Overflow penalty: revealed count should be max(0, baseline.length - 1)
          const expectedMax = Math.max(0, baseline.length - 1)
          expect(overflowResult.length).toBeLessThanOrEqual(expectedMax)
        },
      ),
      { numRuns: 200 },
    )
  })
})

import { applyHealthTick, applyWordSolvedBonus, applyFailurePenalty } from '../ws/gameEngine.js'

// ─── Property tests: health helpers ──────────────────────────────────────────

/**
 * Property 6: Health always stays within [0, 180_000] after any operation
 * Validates: Requirements 12.7
 */
describe('Property 6: Health always stays within [0, 180_000] after any operation', () => {
  it('applyHealthTick returns a value in [0, 180_000]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 180_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        (healthMs, deltaMs) => {
          const result = applyHealthTick(healthMs, deltaMs)
          expect(result).toBeGreaterThanOrEqual(0)
          expect(result).toBeLessThanOrEqual(180_000)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('applyWordSolvedBonus returns a value in [0, 180_000]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 180_000 }),
        (healthMs) => {
          const result = applyWordSolvedBonus(healthMs)
          expect(result).toBeGreaterThanOrEqual(0)
          expect(result).toBeLessThanOrEqual(180_000)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('applyFailurePenalty returns a value in [0, 180_000]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 180_000 }),
        (healthMs) => {
          const result = applyFailurePenalty(healthMs)
          expect(result).toBeGreaterThanOrEqual(0)
          expect(result).toBeLessThanOrEqual(180_000)
        },
      ),
      { numRuns: 200 },
    )
  })
})
