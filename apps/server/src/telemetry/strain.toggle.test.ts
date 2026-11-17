import { afterEach, describe, expect, it, vi } from "vitest";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../utils/logger.js", () => ({ default: { info, warn: vi.fn() } }));

import {
  isTelemetryLoggingEnabled,
  startStrainTelemetry,
  stopStrainTelemetry,
} from "./strain.js";

describe("TELEMETRY_LOGGING_ENABLED", () => {
  afterEach(() => {
    stopStrainTelemetry();
    delete process.env.TELEMETRY_LOGGING_ENABLED;
    vi.restoreAllMocks();
    info.mockClear();
  });

  it.each([undefined, "", "true", "1", "yes", "tru"])(
    "stays on for %s",
    (value) => {
      expect(
        isTelemetryLoggingEnabled({ TELEMETRY_LOGGING_ENABLED: value }),
      ).toBe(true);
    },
  );

  it.each(["false", "FALSE", " 0 "])("turns off for %s", (value) => {
    expect(
      isTelemetryLoggingEnabled({ TELEMETRY_LOGGING_ENABLED: value }),
    ).toBe(false);
  });

  it("does not start the sampler when disabled", () => {
    process.env.TELEMETRY_LOGGING_ENABLED = "false";
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startStrainTelemetry();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("telemetry logging disabled"),
    );
  });

  it("starts the sampler when enabled", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startStrainTelemetry();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
