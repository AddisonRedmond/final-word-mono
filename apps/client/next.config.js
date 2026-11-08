/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	reactStrictMode: true,

	allowedDevOrigins: ["127.0.0.1"],

	async headers() {
		return [
			{
				// Always revalidate the service worker so updates ship promptly.
				source: "/sw.js",
				headers: [
					{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
					{ key: "Content-Type", value: "application/javascript; charset=utf-8" },
				],
			},
			{
				source: "/manifest.webmanifest",
				headers: [
					{ key: "Content-Type", value: "application/manifest+json" },
					{ key: "Cache-Control", value: "public, max-age=3600" },
				],
			},
		];
	},
};

export default config;
