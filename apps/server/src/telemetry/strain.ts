import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import logger from "../utils/logger.js";

/**
 * Strain_Telemetry (Realtime_Broadcast_Scaling, Requirement 1).
 *
 * A single process-level, mode-agnostic signal of process health:
 * event-loop lag (via `perf_hooks.monitorEventLoopDelay`) and resident set
 * size (RSS). It is a STANDING signal — one histogram and one interval timer
 * for the whole process — reported continuously so the operator can tell when
 * a process is strained enough to warrant a bigger box (Req 1.1, 1.2, 1.7).
 *
 * It aggregates/samples rather than logging every tick, so measuring does not
 * materially add to the load being measured (Req 1.5), and it never touches
 * Authoritative_State, gameplay, scoring, or timing — a telemetry fault is
 * swallowed and can never break the server (Req 1.6).
 *
 * Alongside the loop-lag + RSS sampler, this module accumulates broadcast-cost
 * counters (total ticks / bytes / max single-payload bytes / fan-out) via
 * `recordBroadcast`, flushed as an aggregate on the SAME interval and through
 * the SAME flush path — never per tick (Req 1.3, 1.5) — so broadcast pressure
 * is attributable without the measurement itself adding load.
 */

/** Nanoseconds per millisecond — `monitorEventLoopDelay` reports in ns. */
const NS_PER_MS = 1_000_000;

/**
 * Bounded, configurable report interval (ms). Reads `STRAIN_REPORT_INTERVAL_MS`
 * from the environment, defaulting to 10 s — a bounded cadence (Req 1.1, 1.5).
 * Clamped to a sane floor so a misconfigured value can't turn the sampler into
 * a per-tick logger.
 */
export const STRAIN_REPORT_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.STRAIN_REPORT_INTERVAL_MS ?? 10_000),
);

/**
 * Resolution (ms) of the event-loop-delay histogram. The histogram samples the
 * loop at this resolution between flushes.
 */
const LOOP_DELAY_RESOLUTION_MS = 10;

/**
 * The structured sample reported each interval, in the project's `event`-keyed
 * shape (Req 1.4) so it is greppable and consumable by the observability work.
 * All lag figures are milliseconds; `rssBytes` is bytes.
 */
export type StrainSample = {
  event: "strain";
  loopLagMeanMs: number;
  loopLagP99Ms: number;
  loopLagMaxMs: number;
  rssBytes: number;
};

/** Rounds to 3 decimal places so the logged millisecond figures stay compact. */
const roundMs = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Builds the structured strain sample from a loop-delay histogram and a memory
 * snapshot. Pure and side-effect-free (it only READS the histogram), so the
 * sample shape is unit-testable without a running timer. The caller resets the
 * histogram after reading.
 */
export const buildStrainSample = (
  histogram: Pick<IntervalHistogram, "mean" | "percentile" | "max">,
  rssBytes: number,
): StrainSample => {
  // A histogram with no recorded samples returns NaN/Infinity for its stats;
  // normalize those to 0 so the logged sample is always a clean number.
  const safe = (value: number): number =>
    Number.isFinite(value) ? roundMs(value / NS_PER_MS) : 0;

  return {
    event: "strain",
    loopLagMeanMs: safe(histogram.mean),
    loopLagP99Ms: safe(histogram.percentile(99)),
    loopLagMaxMs: safe(histogram.max),
    rssBytes,
  };
};

/**
 * The aggregate broadcast-cost sample reported each interval, in the project's
 * `event`-keyed shape (Req 1.3, 1.4). Covers only the window since the previous
 * report; `ticks` is the number of Broadcast_Ticks recorded, `totalBytes` the
 * sum of all serialized payload sizes, `maxBytes` the largest single payload,
 * and `fanOut` the total socket-sends (sum of recipients across ticks).
 */
export type BroadcastSample = {
  event: "broadcast";
  ticks: number;
  totalBytes: number;
  maxBytes: number;
  fanOut: number;
};

/**
 * Running broadcast-cost counters for the current report window. Plain numbers
 * (not a histogram) because the aggregate is cheap to accumulate per tick and
 * only read/reset on the bounded interval, so recording never logs per tick
 * (Req 1.5).
 */
type BroadcastCounters = {
  ticks: number;
  totalBytes: number;
  maxBytes: number;
  fanOut: number;
};

/** Zeroed counters — the state of a fresh (or just-flushed) report window. */
const emptyBroadcastCounters = (): BroadcastCounters => ({
  ticks: 0,
  totalBytes: 0,
  maxBytes: 0,
  fanOut: 0,
});

/** Module-level singletons: one histogram and one timer for the whole process. */
let histogram: IntervalHistogram | undefined;
let sampleTimer: NodeJS.Timeout | undefined;

/** Process-wide broadcast-cost accumulator, reset after each flush. */
let broadcastCounters: BroadcastCounters = emptyBroadcastCounters();

/**
 * Records one Broadcast_Tick's cost into the current report-window aggregate.
 * Called from inside the emit choke points (`emitRaceUpdate` /
 * `emitLobbyUpdate`) after the payload is serialized, with `bytes` =
 * `Buffer.byteLength(serialized)` and `recipients` = the room's socket count.
 *
 * It only accumulates — it NEVER logs per tick (Req 1.5); the aggregate flushes
 * on the sampler interval. It swallows its own errors so a telemetry fault can
 * never break or drop a Broadcast_Tick (Req 1.6). `mode` and `roomId` are part
 * of the recorder contract (the emit choke points pass them) even though the
 * current aggregate is process-wide; keeping them in the signature lets a later
 * per-mode/per-room breakdown land without touching the call sites.
 */
export const recordBroadcast = ({
  bytes,
  recipients,
}: {
  mode: string;
  roomId: string;
  bytes: number;
  recipients: number;
}): void => {
  try {
    const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const safeRecipients =
      Number.isFinite(recipients) && recipients > 0 ? recipients : 0;

    broadcastCounters.ticks += 1;
    broadcastCounters.totalBytes += safeBytes;
    broadcastCounters.fanOut += safeRecipients;
    if (safeBytes > broadcastCounters.maxBytes) {
      broadcastCounters.maxBytes = safeBytes;
    }
  } catch {
    // A telemetry fault can never drop a Broadcast_Tick — swallow and continue.
  }
};

/**
 * Minimal structural view of a Socket.IO adapter's room map — just the
 * `rooms.get(roomId)?.size` path the recipient count needs — so the choke
 * points can pass either a Namespace's or a Server's adapter without importing
 * socket.io types here. A missing/odd shape yields 0 rather than throwing.
 */
type RoomSizeSource = {
  rooms?: { get(roomId: string): { size?: number } | undefined };
};

/**
 * Reads a room's current socket count (the Broadcast_Tick's fan-out target)
 * from a Socket.IO adapter, defaulting to 0 when the room is empty/unknown.
 * Fully fenced: a telemetry read can never throw into the emit path (Req 1.6).
 */
export const roomSocketCount = (
  adapter: RoomSizeSource | undefined,
  roomId: string,
): number => {
  try {
    const size = adapter?.rooms?.get(roomId)?.size;
    return Number.isFinite(size) && (size as number) > 0 ? (size as number) : 0;
  } catch {
    return 0;
  }
};

/**
 * Measures the serialized size (bytes) of a broadcast payload for the aggregate
 * byte counters, computed once at emit time. Fully fenced so measuring can
 * never throw into the emit path (Req 1.6); an unserializable payload yields 0.
 */
export const broadcastBytes = (payload: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(payload) ?? "");
  } catch {
    return 0;
  }
};

/**
 * Builds the aggregate broadcast sample from the current counters. Pure and
 * side-effect-free so the aggregation is unit-testable without a running timer;
 * the caller resets the counters after reading.
 */
export const buildBroadcastSample = (
  counters: BroadcastCounters,
): BroadcastSample => ({
  event: "broadcast",
  ticks: counters.ticks,
  totalBytes: counters.totalBytes,
  maxBytes: counters.maxBytes,
  fanOut: counters.fanOut,
});

/**
 * Reads the current loop-lag + RSS sample, logs it in the `event`-keyed shape,
 * then resets the histogram so each report covers only the window since the
 * last one. Swallows its own errors — telemetry must never throw into the
 * process (Req 1.6).
 */
const flushLoopLagSample = (): void => {
  try {
    if (!histogram) {
      return;
    }

    const sample = buildStrainSample(histogram, process.memoryUsage().rss);
    logger.info(sample, "strain telemetry");
    histogram.reset();
  } catch {
    // A telemetry fault can never break the server — swallow and keep running.
  }
};

/**
 * Logs the aggregate broadcast-cost sample for the window and resets the
 * counters. Swallows its own errors independently of the loop-lag flush so one
 * failing report can never suppress the other, and so a telemetry fault can
 * never break the server (Req 1.6).
 */
const flushBroadcastSample = (): void => {
  try {
    const sample = buildBroadcastSample(broadcastCounters);
    broadcastCounters = emptyBroadcastCounters();
    logger.info(sample, "broadcast telemetry");
  } catch {
    // A telemetry fault can never break the server — swallow and keep running.
  }
};

/**
 * The single interval flush path: emits both the loop-lag + RSS sample and the
 * aggregate broadcast-cost sample on the SAME bounded interval, reusing the one
 * process timer rather than arming a second (Req 1.3, 1.5). Each sub-flush
 * guards itself so a fault in one can't suppress the other.
 */
const flushSample = (): void => {
  flushLoopLagSample();
  flushBroadcastSample();
};

/**
 * Starts the standing Strain_Telemetry signal: enables one event-loop-delay
 * histogram and arms a single `unref`'d interval timer that flushes the
 * loop-lag + RSS sample every `STRAIN_REPORT_INTERVAL_MS`. Idempotent — a
 * second call while already running is a no-op, so there is exactly one timer
 * per process (Req 1.1, 1.7). Called once at boot.
 */
export const startStrainTelemetry = (): void => {
  if (sampleTimer) {
    return;
  }

  histogram = monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS });
  histogram.enable();

  sampleTimer = setInterval(flushSample, STRAIN_REPORT_INTERVAL_MS);
  // Don't keep the event loop alive for telemetry alone.
  sampleTimer.unref?.();
};

/**
 * Stops the sampler and disables the histogram. Primarily for tests and clean
 * shutdown; production runs the signal for the life of the process.
 */
export const stopStrainTelemetry = (): void => {
  if (sampleTimer) {
    clearInterval(sampleTimer);
    sampleTimer = undefined;
  }
  if (histogram) {
    histogram.disable();
    histogram = undefined;
  }
  broadcastCounters = emptyBroadcastCounters();
};
