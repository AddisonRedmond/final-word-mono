// Polar (polar.sh) checkout — starts a hosted checkout for the premium product
// and redirects the browser to it.
//
// NOTE: This is plumbing only. Buying premium currently unlocks NOTHING in the
// game — the whole app stays free. The webhook handler records premium state on
// the user's profile so it's ready to gate features later, but no feature reads
// that state yet.
//
// Flow: an authenticated (non-guest) user hits this route; we create a Polar
// checkout session tagged with their Supabase user id as the `externalCustomerId`
// so Polar creates/links a customer keyed to OUR user id. Webhooks then arrive
// with that external id and we can match them back to the profile.
import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { polar } from "@/server/polar";
import { createSupabaseApiRouteClient } from "@/utils/supabase/server";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	// Resolve the current Supabase user from the request cookies.
	const supabase = createSupabaseApiRouteClient(req, res);
	let user = null;
	try {
		const {
			data: { user: resolvedUser },
		} = await supabase.auth.getUser();
		user = resolvedUser;
	} catch {
		user = null;
	}

	// Must be signed in, and guests cannot purchase.
	if (!user) {
		return res.redirect("/sign-in?error=auth-required");
	}
	if (user.is_anonymous === true) {
		return res.redirect("/?error=guests-cannot-purchase");
	}

	// Absolute base URL for the success redirect (Polar requires absolute URLs).
	const proto =
		(req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
	const host = req.headers.host ?? "localhost:3000";
	const baseUrl = `${proto}://${host}`;

	try {
		const checkout = await polar.checkouts.create({
			products: [env.NEXT_PUBLIC_POLAR_PREMIUM_PRODUCT_ID],
			// Link the Polar customer to our Supabase user id. Webhooks will carry
			// this back as `external_id` so we can find the right profile.
			externalCustomerId: user.id,
			customerEmail: user.email ?? undefined,
			successUrl: `${baseUrl}/?checkout=success`,
			// Stash the user id in metadata too, as a belt-and-suspenders fallback for
			// matching webhook events that don't surface the customer external id.
			metadata: { supabaseUserId: user.id },
		});

		return res.redirect(checkout.url);
	} catch (error) {
		if (env.NODE_ENV === "development") {
			console.error("[polar] checkout create failed:", error);
		}
		return res.redirect("/?error=checkout-failed");
	}
}
