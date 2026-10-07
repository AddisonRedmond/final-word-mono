// Structured, server-side logger for the Next app (API routes + tRPC), built on
// pino — the same logger the game server uses (apps/server/src/utils/logger.ts),
// kept consistent across the monorepo.
//
// In production pino writes one JSON object per line to stdout, which a log
// pipeline (Datadog, CloudWatch, …) ingests and parses into attributes — so you
// can build monitors/alerts on specific fields. In development it pretty-prints.
//
// SERVER ONLY. Never import from a client component.
//
// Convention: every log carries a stable `event` string (dot-namespaced, e.g.
// "polar.webhook.signature_invalid"). Alert on `event`, not on the free-text
// message — the message can change, the event name is the contract.
//
// pino-in-Next note: pino-pretty runs in a worker thread, which can be awkward
// inside Next's bundled/serverless API routes. We therefore enable the pretty
// transport ONLY in development; production and test emit plain JSON with no
// transport/worker, which is also exactly what Datadog wants.

import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

const baseLogger = pino({
	// A coarse service tag so logs from this app are filterable in a shared
	// pipeline (Datadog `service:` facet, etc.).
	base: { service: "final-word-client" },
	// Silence logs in unit tests to keep output clean.
	level: process.env.NODE_ENV === "test" ? "silent" : "info",
	transport: isDev
		? {
				target: "pino-pretty",
				options: {
					colorize: true,
					ignore: "pid,hostname",
				},
			}
		: undefined,
});

/** Structured fields attached to a log line. `event` is required by convention. */
type LogFields = {
	/** Stable, dot-namespaced event name — the thing you alert on. */
	event: string;
	/** Human-readable message (safe to change; do not alert on this). */
	msg?: string;
	/** Any additional context (ids, counts, error details, …). */
	[key: string]: unknown;
};

/**
 * Normalizes an unknown thrown value into a loggable `{ message, stack }` so
 * error fields are consistent across call sites (and never dump a raw object
 * that stringifies to "{}").
 */
export const serializeError = (
	error: unknown,
): { message: string; stack?: string } => {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack };
	}
	return { message: String(error) };
};

// Thin wrapper so call sites keep the `logger.info({ event, msg, ... })` shape.
// pino's native signature is `logger.info(obj, msg)`, so we pull `msg` out of
// the fields and pass it as pino's message argument (it still appears as `msg`
// in the JSON, matching the previous output).
const log = (
	level: "debug" | "info" | "warn" | "error",
	fields: LogFields,
): void => {
	const { msg, ...rest } = fields;
	baseLogger[level](rest, msg);
};

export const logger = {
	debug: (fields: LogFields) => log("debug", fields),
	info: (fields: LogFields) => log("info", fields),
	warn: (fields: LogFields) => log("warn", fields),
	error: (fields: LogFields) => log("error", fields),
};

export default logger;
