// Feature: anonymous-sign-in
// Pure server-side helpers for detecting guest (anonymous) users and resolving
// their display name at socket connect. No DB or network calls — these read
// straight off the already-resolved Supabase user object (R4.1). Kept behind a
// clearly named `anonymous` seam so the whole feature is removable in one pass (R9).

/**
 * Fail-safe default: an unknown / missing `is_anonymous` is treated as
 * anonymous (R4.4). Over-restricting a user is strictly safer than accidentally
 * granting a guest social/persistent access.
 */
export const ANON_FAIL_SAFE = true;

/**
 * Resolve whether a user is a guest (anonymous) from the already-resolved
 * Supabase user — no extra DB query (R4.1).
 *
 * Returns `false` only when `is_anonymous` is strictly `false`; returns `true`
 * for `true`, `undefined`, `null`, or an absent field (the nullish fail-safe,
 * R4.2–R4.4).
 */
export const resolveIsAnonymous = (user: {
  is_anonymous?: boolean | null;
}): boolean =>
  user.is_anonymous == null ? ANON_FAIL_SAFE : user.is_anonymous === true;

/**
 * Resolve a user's display name at socket connect (R3.2, R3.3). Returns
 * `user_metadata.full_name` when it is a string containing at least one
 * non-whitespace character; otherwise falls back to `"Player"` for absent,
 * empty, whitespace-only, or non-string values.
 */
export const resolveDisplayName = (user: {
  user_metadata?: { full_name?: unknown };
}): string => {
  const fullName = user.user_metadata?.full_name;
  return typeof fullName === "string" && fullName.trim().length > 0
    ? fullName
    : "Player";
};
