/**
 * SafeSignal service worker.
 *
 * Two jobs: make the app installable to a home screen, and make it open when
 * there is no signal. Nothing here does background work — a web worker cannot
 * watch sensors or fire a check-in while the app is closed, and this file does
 * not pretend otherwise.
 *
 * Caching strategy is chosen so a safety app never serves a stale build:
 *
 *   Navigations  → network first, cache as fallback.
 *     Always the newest code when online; the shell still opens offline.
 *
 *   Hashed assets → cache first.
 *     /assets/* filenames contain a content hash, so a given URL can never
 *     change meaning and caching it forever is safe.
 *
 *   Everything else → network, falling back to cache.
 */

const VERSION = 'v1';
const SHELL_CACHE = `safesignal-shell-${VERSION}`;
const ASSET_CACHE = `safesignal-assets-${VERSION}`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            // Individual failures must not abort the install; a missing optional
            // file should not leave the app without a worker at all.
            .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // SPA navigations: every route resolves to the same shell document.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match('/index.html');
                    return (
                        cached ??
                        new Response(
                            '<!doctype html><meta charset="utf-8"><title>SafeSignal</title>' +
                            '<p style="font-family:system-ui;padding:2rem">' +
                            'SafeSignal is offline and has not been opened on this device before.</p>',
                            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
                        )
                    );
                }),
        );
        return;
    }

    // Build output is content-hashed, so a cache hit is always correct.
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
        event.respondWith(
            caches.match(request).then(
                (cached) =>
                    cached ??
                    fetch(request).then((response) => {
                        if (response.ok) {
                            const copy = response.clone();
                            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
                        }
                        return response;
                    }),
            ),
        );
        return;
    }

    event.respondWith(fetch(request).catch(() => caches.match(request)));
});
