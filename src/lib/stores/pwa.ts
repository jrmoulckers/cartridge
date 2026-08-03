import { writable } from 'svelte/store';
import { registerSW } from 'virtual:pwa-register';
import { showToast } from './toast';

/**
 * Service-worker lifecycle, surfaced to the UI.
 *
 * Built with `registerType: 'prompt'` so a fresh deployment never swaps assets out from
 * under a half-written review. The waiting worker raises {@link needRefresh} and
 * `UpdateBanner.svelte` offers a single "Refresh" action. Going offline-capable for the
 * first time raises a toast, because the local-first promise deserves to be visible.
 */

/** True when a new version has been downloaded and is waiting to activate. */
export const needRefresh = writable(false);

/** How often a long-lived tab re-checks for a new deployment. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

/** Wire the service worker. Called once from boot. */
export function initPWA(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.set(true);
    },
    onOfflineReady() {
      showToast('Ready to use offline — no account needed', 'success', 4000);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        void registration.update();
      }, UPDATE_INTERVAL_MS);
    },
  });
}

/** Activate the waiting worker and reload onto the new version. */
export function applyUpdate(): void {
  needRefresh.set(false);
  void updateSW?.(true);
}

/** Keep the current version for now; the prompt returns on the next update check. */
export function dismissUpdate(): void {
  needRefresh.set(false);
}
