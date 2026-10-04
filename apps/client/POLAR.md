# Polar (premium access) — setup & local testing

Polar (polar.sh) billing is **wired up but inert**: a user can check out and we
record their subscription state, but **nothing in the game is paywalled**. The
whole app stays free until we add feature gates. This doc covers configuration
and testing the plumbing locally.

## What exists

| Piece | Location |
| --- | --- |
| Env vars | `src/env.js` (+ `.env`, `.env.example`) |
| Polar API client (singleton) | `src/server/polar.ts` |
| Start checkout | `GET /api/polar/checkout` → `src/pages/api/polar/checkout.ts` |
| Customer portal | `GET /api/polar/portal` → `src/pages/api/polar/portal.ts` |
| Webhook receiver | `POST /api/webhooks/polar` → `src/pages/api/webhooks/polar.ts` |
| Premium status API | `billing.status` tRPC query → `src/server/api/routers/billing.ts` |
| DB fields | `profiles.polar_customer_id`, `profiles.premium_status`, `profiles.premium_until` (`packages/db/src/schema.ts`, migration `drizzle/0005_bored_spectrum.sql`) |

`billing.status` returns `{ isPremium, status, premiumUntil }`. `isPremium` is
derived but **not read by any feature yet** — that's the hook for later
paywalling.

## Environment variables

Set these in `apps/client/.env` (use **sandbox** values for local dev):

| Var | What |
| --- | --- |
| `POLAR_ACCESS_TOKEN` | Organization Access Token (secret). Polar dashboard → Settings → Developers. |
| `POLAR_WEBHOOK_SECRET` | Signing secret from the webhook endpoint you create. |
| `POLAR_SERVER` | `sandbox` or `production`. Defaults to `sandbox`. |
| `NEXT_PUBLIC_POLAR_PREMIUM_PRODUCT_ID` | Product ID of your premium product (public). |

Use the sandbox dashboard at <https://sandbox.polar.sh> and create a **sandbox**
Organization Access Token. Create your premium **subscription** product there
and copy its Product ID.

## Local testing

The SDK (`@polar-sh/sdk@0.49.0`) talks to the sandbox API when `POLAR_SERVER=sandbox`.
Webhooks need a public URL, so use the Polar CLI to tunnel them to localhost.

1. **Install the Polar CLI** (see <https://polar.sh/docs/integrate/webhooks/locally>).

2. **Log in to the sandbox:**

   ```bash
   polar login
   ```

3. **Forward webhooks to the local app** (run the Next dev server on :3000 first
   with `pnpm --filter client dev`):

   ```bash
   pnpm --filter client polar:listen
   # == polar listen http://localhost:3000/api/webhooks/polar
   ```

   Copy the signing secret the CLI/endpoint uses into `POLAR_WEBHOOK_SECRET`.

4. **Trigger a sample event** (new terminal) without a real purchase:

   ```bash
   polar trigger subscription.active
   ```

   Run `polar trigger` with no args to pick from a list. The webhook handler
   verifies the signature and writes `premium_status` / `premium_until` onto the
   matching `profiles` row.

   > Sample events carry a random customer `external_id`, so they won't match a
   > real local user row. To exercise the full match, override the external id to
   > a real Supabase user id:
   >
   > ```bash
   > polar trigger subscription.active data.customer.external_id=<your-user-uuid>
   > ```

5. **Real end-to-end checkout:** sign in as a non-guest user and open
   `/api/polar/checkout` in the browser. Complete checkout with a Polar sandbox
   test card. The `subscription.active` webhook then flips that user's premium
   fields. Verify via the `billing.status` query or by inspecting the `profiles`
   row.

## Going to production

- Swap `.env` to production values: a **production** `POLAR_ACCESS_TOKEN`,
  `POLAR_SERVER=production`, the production `NEXT_PUBLIC_POLAR_PREMIUM_PRODUCT_ID`.
- In the Polar **production** dashboard, add a webhook endpoint pointing at
  `https://<your-domain>/api/webhooks/polar` and put its signing secret in
  `POLAR_WEBHOOK_SECRET`.

## When you're ready to paywall

Everything above records state only. To gate a feature:

1. Read status server-side (`billing.status`, or query `profiles` directly in
   the relevant tRPC procedure).
2. Branch on `isPremium`.

Nothing today depends on `isPremium`, so flipping features behind it is additive.
