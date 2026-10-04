import { Polar } from "@polar-sh/sdk";

import { env } from "@/env";

/**
 * Singleton Polar (polar.sh) API client — reused across hot-reloads in dev to
 * avoid creating a new client on every request.
 *
 * Authenticated with the Organization Access Token (`POLAR_ACCESS_TOKEN`) and
 * pointed at the sandbox or production API via `POLAR_SERVER`. Server-only —
 * never import this from client components.
 */
const globalForPolar = globalThis as unknown as {
	polar: Polar | undefined;
};

export const polar =
	globalForPolar.polar ??
	new Polar({
		accessToken: env.POLAR_ACCESS_TOKEN,
		server: env.POLAR_SERVER,
	});

if (env.NODE_ENV !== "production") {
	globalForPolar.polar = polar;
}
