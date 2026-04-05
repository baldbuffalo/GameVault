/**
 * sw-register.js
 *
 * Include as the FIRST <script> in <head> of both index.html and emulator.html:
 *
 *   <script src="sw-register.js"></script>
 *
 * Registers the service worker that adds COOP/COEP headers (required for
 * SharedArrayBuffer / Dolphin threads). On first visit the SW installs and
 * the page reloads once automatically so the headers are active immediately.
 */
(async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    if (reg.installing) {
      reg.installing.addEventListener('statechange', function () {
        if (this.state === 'activated') {
          if (!sessionStorage.getItem('sw-reloaded')) {
            sessionStorage.setItem('sw-reloaded', '1');
            window.location.reload();
          }
        }
      });
    }
  } catch (err) {
    console.warn('[GameVault] Service worker registration failed:', err);
  }
})();
