// @ts-nocheck -- runs in a ServiceWorker scope, not the DOM lib used by tsc.
/* Final Word service worker.
 * - Static assets: stale-while-revalidate.
 * - Page navigations: network-first, falling back to /offline.html.
 * - API, tRPC, socket.io and cross-origin requests are never touched, so
 *   multiplayer and auth always hit the network.
 * Bump CACHE_VERSION to invalidate old caches.
 */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `fw-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(STATIC_CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k.startsWith("fw-") && k !== STATIC_CACHE)
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

function isStaticAsset(url) {
	return (
		url.pathname.startsWith("/_next/static/") ||
		url.pathname.startsWith("/icons/") ||
		/\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
	);
}

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) {
		return;
	}

	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request).catch(() =>
				caches.match(OFFLINE_URL).then((r) => r || Response.error()),
			),
		);
		return;
	}

	if (isStaticAsset(url)) {
		event.respondWith(
			caches.open(STATIC_CACHE).then(async (cache) => {
				const cached = await cache.match(request);
				const network = fetch(request)
					.then((response) => {
						if (response.ok) cache.put(request, response.clone());
						return response;
					})
					.catch(() => cached);
				return cached || network;
			}),
		);
	}
});
