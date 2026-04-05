/**
 * sw.js — GameVault service worker
 *
 * GitHub Pages cannot set custom HTTP response headers, but Dolphin WASM needs
 * SharedArrayBuffer for its thread pool. Browsers gate SharedArrayBuffer behind:
 *
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 *
 * This service worker intercepts every fetch and re-attaches those headers so
 * the page becomes cross-origin isolated without any server configuration.
 */

const CACHE_NAME = 'gamevault-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.type === 'opaque') return response;

        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy',   'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

        return new Response(response.body, {
          status:     response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch(() => fetch(e.request))
  );
});
