import { create } from "zustand";
import type { Socket } from "socket.io-client";

type ServerClockState = {
  /**
   * Estimated `serverNow - clientNow` in milliseconds. Positive means the
   * server clock is ahead of this client's clock. Applied to every absolute
   * server timestamp before it is rendered so timers stay accurate even when
   * the two clocks disagree.
   */
  offsetMs: number;
  isSynced: boolean;
  /** Runs the sync handshake over the given socket. Safe to call repeatedly. */
  sync: (socket: Socket) => Promise<void>;
  reset: () => void;
};

// Number of round-trip samples to take; we keep the one with the lowest
// latency, which yields the most accurate offset estimate.
const SAMPLE_COUNT = 5;
const SAMPLE_TIMEOUT_MS = 3000;

type TimeSyncResponse = { serverNow: number };

const requestSample = (socket: Socket): Promise<TimeSyncResponse | null> =>
  new Promise((resolve) => {
    const clientSentAt = Date.now();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, SAMPLE_TIMEOUT_MS);

    socket
      .timeout(SAMPLE_TIMEOUT_MS)
      .emit(
        "time:sync",
        clientSentAt,
        (error: Error | null, response: TimeSyncResponse) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(error ? null : response);
        },
      );
  });

export const useServerClockStore = create<ServerClockState>((set) => ({
  offsetMs: 0,
  isSynced: false,
  sync: async (socket: Socket) => {
    let bestRoundTrip = Number.POSITIVE_INFINITY;
    let bestOffset = 0;
    let gotSample = false;

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const clientSentAt = Date.now();
      const response = await requestSample(socket);
      const clientReceivedAt = Date.now();

      if (!response) {
        continue;
      }

      const roundTrip = clientReceivedAt - clientSentAt;
      // Assume symmetric latency: the server timestamp corresponds to the
      // midpoint of the round trip on the client clock.
      const clientMidpoint = clientSentAt + roundTrip / 2;
      const offset = response.serverNow - clientMidpoint;

      if (roundTrip < bestRoundTrip) {
        bestRoundTrip = roundTrip;
        bestOffset = offset;
        gotSample = true;
      }
    }

    if (gotSample) {
      set({ offsetMs: bestOffset, isSynced: true });
    }
  },
  reset: () => set({ offsetMs: 0, isSynced: false }),
}));

/** The server's current time expressed on the server clock. */
export const getServerNow = () => Date.now() + useServerClockStore.getState().offsetMs;

/**
 * Converts an absolute *server* timestamp into the equivalent timestamp on the
 * *client* clock, so browser-based timers (which compare against the local
 * clock) compute the correct remaining time.
 */
export const toClientTime = (serverTimestamp: number) =>
  serverTimestamp - useServerClockStore.getState().offsetMs;
