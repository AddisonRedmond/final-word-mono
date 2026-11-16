/**
 * This is the client-side entrypoint for your tRPC API. It is used to create the `api` object which
 * contains the Next.js App-wrapper, as well as your type-safe React Query hooks.
 *
 * We also create a few inference helpers for input and output types.
 */
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";
import { ssrPrepass } from "@trpc/next/ssrPrepass";

import type { AppRouter } from "@/server/api/root";
import { handleUnauthorized } from "@/state/auth-store";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""; // browser should use relative url
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url
  return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCNext<AppRouter>({
  ssr: false,
  // ssrPrepass,
  config() {
    return {
      queryClientConfig: {
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            // Reuse results for 30s so focusing the tab or navigating between
            // pages doesn't refetch everything. Data that must be live opts back
            // in with `staleTime: 0` at the call site.
            staleTime: 30_000,
          },
        },
      },
      /**
       * Links used to determine request flow from client to server.
       *
       * @see https://trpc.io/docs/links
       */
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
          /**
           * Transformer used for data de-serialization from the server.
           *
           * @see https://trpc.io/docs/data-transformers
           */
          transformer: superjson,
          url: `${getBaseUrl()}/api/trpc`,
          // A 401 means the server no longer accepts the session. Let the auth
          // store verify it and sign out (which redirects to /sign-in) rather
          // than leaving the user on a page full of failed queries.
          async fetch(url, options) {
            const response = await fetch(url, options);
            if (response.status === 401 && typeof window !== "undefined") {
              void handleUnauthorized();
            }
            return response;
          },
        }),
      ],
    };
  },
  /**
   * Whether tRPC should await queries when server rendering pages.
   *
   * @see https://trpc.io/docs/nextjs#ssr-boolean-default-false
   */
  transformer: superjson,
});

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
