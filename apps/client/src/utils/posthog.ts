import posthog from "posthog-js";
import { env } from "@/env";

/**
 * The analytics events we deliberately track, as a closed union so call sites
 * can't drift into ad-hoc, misspelled, or one-off event names. These map to the
 * activation/engagement funnel we care about (see `.kiro/specs/feature.md`):
 * does a visitor start a game, and do they finish one?
 *
 * Keep this list SMALL and intentional — every event here should answer a
 * question we're actually asking. Add one only when there's a funnel/retention
 * question it unlocks, not "just in case".
 */
export type AnalyticsEvent =
  | "index_viewed"
  | "quick_duel_clicked"
  | "quick_duel_queued"
  | "quick_duel_matched"
  | "duel_created"
  | "duel_completed"
  | "realtime_game_started"
  | "realtime_game_finished";

let initialized = false;

/**
 * Whether analytics is configured. PostHog only runs when a project key is set
 * (prod), so local dev / preview builds are no-ops without any guards at call
 * sites.
 */
const isEnabled = (): boolean =>
  typeof window !== "undefined" && Boolean(env.NEXT_PUBLIC_POSTHOG_KEY);

/**
 * Initialize PostHog once, on the client. Safe to call repeatedly (guarded).
 * No-op when no key is configured, so nothing analytics-related runs in dev.
 *
 * `capture_pageview` is left on PostHog's default so route changes are tracked
 * automatically; we add explicit funnel events on top via `track`.
 */
export const initAnalytics = (): void => {
  if (initialized || !isEnabled()) {
    return;
  }
  initialized = true;

  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY as string, {
    api_host: env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    // Respect user privacy by default: don't autocapture every click/input, and
    // mask text in any session data. We rely on explicit `track` events plus
    // pageviews, which keeps the data clean and the payload small.
    autocapture: false,
    capture_pageview: true,
    persistence: "localStorage+cookie",
  });
};

/**
 * Tie subsequent events to a known user (call on sign-in / when auth resolves).
 * No-op when analytics is disabled.
 */
export const identifyUser = (userId: string): void => {
  if (!isEnabled()) {
    return;
  }
  posthog.identify(userId);
};

/** Clear the identified user (call on sign-out). No-op when disabled. */
export const resetAnalytics = (): void => {
  if (!isEnabled()) {
    return;
  }
  posthog.reset();
};

/**
 * Record a funnel event. Fire-and-forget and fully guarded: a disabled or
 * failed analytics call can never throw into gameplay or UI code.
 */
export const track = (
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void => {
  if (!isEnabled()) {
    return;
  }
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics must never break the app — swallow any capture error.
  }
};
