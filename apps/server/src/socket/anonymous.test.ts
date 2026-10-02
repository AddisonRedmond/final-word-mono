import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolveDisplayName, resolveIsAnonymous } from "./anonymous.js";

// Feature: anonymous-sign-in, Property 1: Anonymous resolution truth table
//
// For any value of `is_anonymous` on a resolved user — `true`, `false`,
// `undefined`, `null`, or absent — `resolveIsAnonymous(user)` returns `false`
// exactly when the value is strictly `false`, and `true` in every other case
// (including the nullish fail-safe default).
//
// Validates: Requirements 4.2, 4.3, 4.4

describe("resolveIsAnonymous — anonymous resolution truth table (Property 1)", () => {
  it("returns false iff is_anonymous is strictly false, else true", () => {
    // Model the full input space: every allowed `is_anonymous` value plus the
    // absent-field case. We encode "absent" distinctly so the generator can
    // build a user object that omits the key entirely.
    const inputArb = fc.oneof(
      fc.constant<{ is_anonymous?: boolean | null }>({ is_anonymous: true }),
      fc.constant<{ is_anonymous?: boolean | null }>({ is_anonymous: false }),
      fc.constant<{ is_anonymous?: boolean | null }>({ is_anonymous: undefined }),
      fc.constant<{ is_anonymous?: boolean | null }>({ is_anonymous: null }),
      // absent field: an object with no `is_anonymous` key at all
      fc.constant<{ is_anonymous?: boolean | null }>({}),
    );

    fc.assert(
      fc.property(inputArb, (user) => {
        const expected = user.is_anonymous !== false;
        expect(resolveIsAnonymous(user)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
// Feature: anonymous-sign-in, Property 3: Display-name resolution prefers a non-blank full_name
//
// For any resolved user, `resolveDisplayName(user)` returns
// `user_metadata.full_name` verbatim when it is a string with at least one
// non-whitespace character; otherwise it falls back to `"Player"` for an
// absent field, an empty string, a whitespace-only string, or any non-string
// value.
//
// Validates: Requirements 3.2, 3.3

describe("resolveDisplayName — prefers a non-blank full_name (Property 3)", () => {
  it("returns a non-blank string full_name verbatim", () => {
    // A string with >= 1 non-whitespace char. We allow surrounding whitespace
    // to confirm the value is returned as-is (never trimmed), only used as the
    // blank/non-blank discriminator.
    const nonBlankArb = fc
      .string()
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(nonBlankArb, (fullName) => {
        const user = { user_metadata: { full_name: fullName } };
        expect(resolveDisplayName(user)).toBe(fullName);
      }),
      { numRuns: 100 },
    );
  });

  it('falls back to "Player" for absent, empty, whitespace-only, or non-string full_name', () => {
    // Model every path to the fallback:
    //  - absent user_metadata entirely
    //  - absent full_name key
    //  - empty / whitespace-only strings (blank)
    //  - non-string values (number, boolean, null, object, array)
    const whitespaceArb = fc
      .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
        maxLength: 8,
      })
      .map((chars) => chars.join(""));

    const blankOrNonStringArb = fc.oneof(
      // absent user_metadata
      fc.constant<{ user_metadata?: { full_name?: unknown } }>({}),
      // present user_metadata but absent full_name
      fc.constant<{ user_metadata?: { full_name?: unknown } }>({
        user_metadata: {},
      }),
      // blank strings (empty or whitespace-only)
      whitespaceArb.map((s) => ({ user_metadata: { full_name: s } })),
      // non-string values
      fc
        .oneof(
          fc.integer(),
          fc.double(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.object(),
          fc.array(fc.anything()),
        )
        .map((v) => ({ user_metadata: { full_name: v } })),
    );

    fc.assert(
      fc.property(blankOrNonStringArb, (user) => {
        expect(resolveDisplayName(user)).toBe("Player");
      }),
      { numRuns: 100 },
    );
  });
});
