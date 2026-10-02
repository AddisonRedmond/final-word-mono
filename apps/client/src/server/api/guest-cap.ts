// Feature: anonymous-sign-in
// Guest account cap counter — a named seam so the whole feature is greppable and
// removable in one pass (R9.6). Counts concurrent anonymous accounts so the
// sign-in endpoint can enforce the soft cap.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Soft cap on concurrent anonymous accounts (R2.3). */
export const ANON_ACCOUNT_CAP = 100;

/** Page size used while paginating the full auth.users set. */
const COUNT_PAGE_SIZE = 1000;

/**
 * Count all accounts with `is_anonymous === true` by paginating the full
 * `auth.users` set with the service-role admin client (R2.1).
 *
 * Throws if any page fetch fails so the caller can surface `COUNT_FAILED`
 * distinctly from the cap rejection (R2.2). The count is independent of where
 * the page boundaries fall.
 */
export const countAnonymousUsers = async (
	admin: SupabaseClient,
): Promise<number> => {
	let anonymousCount = 0;
	let page = 1;

	// Paginate until the admin API reports no further page.
	for (;;) {
		const { data, error } = await admin.auth.admin.listUsers({
			page,
			perPage: COUNT_PAGE_SIZE,
		});

		// Any page-fetch failure must abort the count (never a partial result) so
		// the caller can report COUNT_FAILED rather than mistaking it for the cap.
		if (error) {
			throw error;
		}

		for (const user of data.users) {
			if (user.is_anonymous === true) {
				anonymousCount += 1;
			}
		}

		// `nextPage` is null once the final page has been returned.
		const nextPage = (data as { nextPage?: number | null }).nextPage;
		if (nextPage == null) {
			break;
		}
		page = nextPage;
	}

	return anonymousCount;
};
