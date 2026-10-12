import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import logger from "../utils/logger.js";
import {
  buildBroadcastSample,
  buildStrainSample,
  recordBroadcast,
  startStrainTelemetry,
  STRAIN_REPORT_INTERVAL_MS,
  stopStrainTelemetry,
} from "./strain.js";

// Feature: realtime-broadcast-scaling, Task 1.1 — Loop-lag + RSS sampler.
//
// Strain_Telemetry is a standing process-health signal: a monitorEventLoopDelay
// histogram started once at boot and a bounded-interval sampler that logs
// mean/p99 lag and RSS in the `event`-keyed shape, then resets the histogram.
// There is exactly one timer for the whole process (Req 1.1, 1.2, 1.4, 1.7),
// it samples rather than logging per tick (Req 1.5), and a telemetry fault can
// never throw into the process (Req 1.6).
//
// We unit-test the pure sample builder (shape + unit conversion + empty-window
// normalization) and the timer lifecycle (single timer, reset, swallowed
// errors) with fake timers, so no real event-loop load is needed.
//
// Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.7

/** A minimal histogram stub exposing only what `buildStrainSample` reads. */
const makeHistogram = (opts: {
  mean: number;
  p99: number;
  max: number;
}) => ({
  mean: opts.mean,
  max: opts.max,
  percentile: (_p: number) => opts.p99,
});

describe("buildStrainSample", () => {
  it("reports the event-keyed shape with lag converted ns -> ms", () => {
    // 1 ms = 1_000_000 ns.
    const histogram = makeHistogram({
      mean: 2_000_000, // 2 ms
      p99: 5_000_000, // 5 ms
      max: 9_000_000, // 9 ms
    });

    const sample = buildStrainSample(histogram, 123_456);

    expect(sample).toEqual({
      event: "strain",
      loopLagMeanMs: 2,
      loopLagP99Ms: 5,
      loopLagMaxMs: 9,
      rssBytes: 123_456,
    });
  });

  it("normalizes an empty-window histogram (NaN/Infinity) to zero", () => {
    // monitorEventLoopDelay returns NaN mean / Infinity max before any sample.
    const histogram = makeHistogram({
      mean: Number.NaN,
      p99: Number.NaN,
      max: Number.POSITIVE_INFINITY,
    });

    const sample = buildStrainSample(histogram, 42);

    expect(sample).toEqual({
      event: "strain",
      loopLagMeanMs: 0,
      loopLagP99Ms: 0,
      loopLagMaxMs: 0,
      rssBytes: 42,
    });
  });

  it("rounds fractional milliseconds to 3 decimal places", () => {
    const histogram = makeHistogram({
      mean: 1_234_567, // 1.234567 ms
      p99: 1_234_567,
      max: 1_234_567,
    });

    const sample = buildStrainSample(histogram, 0);

    expect(sample.loopLagMeanMs).toBe(1.235);
  });
});

// Feature: realtime-broadcast-scaling, Task 1.2 — Broadcast counters with
// aggregate flush.
//
// recordBroadcast accumulates per-tick cost (tick count, total/max bytes, total
// fan-out) into a process-wide window and the aggregate flushes on the SAME
// sampler interval as the loop-lag/RSS report (one timer, one flush path) — it
// never logs per tick (Req 1.3, 1.5) and swallows its own errors so a telemetry
// fault can never drop a Broadcast_Tick (Req 1.6).
//
// Validates: Requirements 1.3, 1.5, 1.6

describe("buildBroadcastSample", () => {
  it("reports the event-keyed aggregate shape", () => {
    const sample = buildBroadcastSample({
      ticks: 3,
      totalBytes: 900,
      maxBytes: 400,
      fanOut: 120,
    });

    expect(sample).toEqual({
      event: "broadcast",
      ticks: 3,
      totalBytes: 900,
      maxBytes: 400,
      fanOut: 120,
    });
  });
});

describe("recordBroadcast (aggregation + flush)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Swallow log output; we assert on the sample passed to the logger.
    vi.spyOn(logger, "info").mockImplementation(() => logger);
  });

  afterEach(() => {
    stopStrainTelemetry();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  type LoggedBroadcastSample = {
    event: string;
    ticks: number;
    totalBytes: number;
    maxBytes: number;
    fanOut: number;
  };

  /** All broadcast samples the logger spy has seen, in flush order. */
  const broadcastSamples = (
    spy: ReturnType<typeof vi.spyOn>,
  ): LoggedBroadcastSample[] =>
    spy.mock.calls
      .map((args) => args[0])
      .filter(
        (arg): arg is LoggedBroadcastSample =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as { event?: string }).event === "broadcast",
      );

  /**
   * Advancing the fake clock drives one flush per interval, so the window's
   * recorded aggregate lands in the FIRST broadcast sample; later flushes are
   * zeroed (the counters were drained). Assert on the first.
   */
  const firstBroadcastSample = (spy: ReturnType<typeof vi.spyOn>) =>
    broadcastSamples(spy)[0];

  it("accumulates ticks, total/max bytes and fan-out, flushing on the interval", () => {
    const infoSpy = vi.spyOn(logger, "info");
    startStrainTelemetry();

    recordBroadcast({ mode: "race", roomId: "r1", bytes: 100, recipients: 10 });
    recordBroadcast({ mode: "race", roomId: "r1", bytes: 400, recipients: 20 });
    recordBroadcast({ mode: "battle-royale", roomId: "b1", bytes: 250, recipients: 5 });

    // Nothing is logged per tick — the aggregate only appears on flush (Req 1.5).
    expect(broadcastSamples(infoSpy)).toHaveLength(0);

    // Advance exactly one report interval to drive a single flush.
    vi.advanceTimersByTime(STRAIN_REPORT_INTERVAL_MS);

    expect(firstBroadcastSample(infoSpy)).toEqual({
      event: "broadcast",
      ticks: 3,
      totalBytes: 750,
      maxBytes: 400,
      fanOut: 35,
    });
  });

  it("resets the aggregate after each flush", () => {
    const infoSpy = vi.spyOn(logger, "info");
    startStrainTelemetry();

    recordBroadcast({ mode: "race", roomId: "r1", bytes: 100, recipients: 10 });
    vi.advanceTimersByTime(STRAIN_REPORT_INTERVAL_MS);
    expect(broadcastSamples(infoSpy)[0]?.ticks).toBe(1);

    // The next window records nothing, so its flush is a zeroed aggregate —
    // the first window's counts did not carry over.
    vi.advanceTimersByTime(STRAIN_REPORT_INTERVAL_MS);
    expect(broadcastSamples(infoSpy)[1]).toEqual({
      event: "broadcast",
      ticks: 0,
      totalBytes: 0,
      maxBytes: 0,
      fanOut: 0,
    });
  });

  it("ignores non-finite / negative inputs without throwing", () => {
    const infoSpy = vi.spyOn(logger, "info");
    startStrainTelemetry();

    expect(() => {
      recordBroadcast({
        mode: "race",
        roomId: "r1",
        bytes: Number.NaN,
        recipients: -5,
      });
      recordBroadcast({
        mode: "race",
        roomId: "r1",
        bytes: 300,
        recipients: 8,
      });
    }).not.toThrow();

    vi.advanceTimersByTime(STRAIN_REPORT_INTERVAL_MS);

    expect(firstBroadcastSample(infoSpy)).toEqual({
      event: "broadcast",
      ticks: 2,
      totalBytes: 300,
      maxBytes: 300,
      fanOut: 8,
    });
  });

  it("swallows its own errors so a telemetry fault can never throw into the emit path", () => {
    expect(() =>
      recordBroadcast({
        mode: "race",
        roomId: "r1",
        bytes: 100,
        recipients: 10,
      }),
    ).not.toThrow();
  });
});

describe("start/stopStrainTelemetry (timer lifecycle)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopStrainTelemetry();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("arms exactly one interval timer and is idempotent", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startStrainTelemetry();
    // A second call while already running must not add another timer.
    startStrainTelemetry();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("flushes a sample on the interval without throwing", () => {
    startStrainTelemetry();

    // Advancing past one interval must drive at least one flush and never throw.
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
  });

  it("stops cleanly and can be restarted", () => {
    startStrainTelemetry();
    stopStrainTelemetry();

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    startStrainTelemetry();

    // After a stop, starting again arms a fresh single timer.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
