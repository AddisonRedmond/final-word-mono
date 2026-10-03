// Polar (polar.sh) customer portal — opens the hosted portal where a customer
// can manage/cancel their subscription and view orders.
//
// Plumbing only; see the note in ./checkout.ts. We create a customer session
// keyed by the Supabase user id (set as the Polar customer's external id during
// checkout) and redirect to the returned portal URL.
import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { polar } from "@/server/polar";
import { createSupabaseApiRouteClient } from "@/utils/supabase/server";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
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

	if (!user) {
		return res.redirect("/sign-in?error=auth-required");
	}
	if (user.is_anonymous === true) {
		return res.redirect("/?error=guests-cannot-purchase");
	}

	try {
		const session = await polar.customerSessions.create({
			// Match the customer by the external id we set at checkout (our user id).
			externalCustomerId: user.id,
		});

		return res.redirect(session.customerPortalUrl);
	} catch (error) {
		if (env.NODE_ENV === "development") {
			console.error("[polar] portal session create failed:", error);
		}
		// Most common cause: the user has never checked out, so no Polar customer
		// exists yet. Send them home rather than erroring hard.
		return res.redirect("/?error=no-subscription");
	}
}
