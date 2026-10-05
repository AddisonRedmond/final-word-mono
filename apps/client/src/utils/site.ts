/**
 * Canonical site metadata used for SEO (canonical URLs, OpenGraph, sitemap).
 *
 * SITE_URL must be the production origin with no trailing slash. It's a plain
 * constant (not an env var) so builds never fail when it's unset — but update
 * it to your real domain so canonical/OG/sitemap URLs are correct. If you add a
 * NEXT_PUBLIC_SITE_URL env var later, read it here with this as the fallback.
 */
export const SITE_URL = "https://finalword.app";

export const SITE_NAME = "Final Word";

export const SITE_DESCRIPTION =
	"Final Word is a fast-paced multiplayer word game. Guess the hidden five-letter word in a head-to-head duel with friends, or race the field in live Battle Royale and Race modes. Think fast, guess smart, and have the final word.";
