/**
 * Steam sign-in, from the app's side.
 *
 * Steam speaks OpenID 2.0, which requires a server to verify an assertion — a browser
 * cannot do it, and a browser that tried would be trusting parameters an attacker controls.
 * So the app's entire role in sign-in is two things: send the user to the bridge, and read
 * the answer the bridge redirects back with.
 *
 * The answer arrives in the URL **fragment**, which browsers never transmit to a server, so
 * a freshly verified account number does not end up in an access log or a `Referer` header
 * on the way past. {@link readSteamResult} clears it from the address bar immediately, so a
 * reload or a shared link carries nothing.
 */
import { bridgeBase } from '../metadata/igdb';

export type SteamAuthOutcome =
  | { kind: 'connected'; steamId: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

const STEAMID = /^\d{17}$/;

/**
 * Where "Connect Steam" sends the browser, or `null` when there is no bridge to send it to.
 *
 * `return` is the page to come back to — Settings, where the user pressed the button. The
 * bridge checks it against the same allowlist CORS uses, so a wrong origin is refused there
 * rather than followed.
 */
export function steamLoginUrl(returnTo: string = currentPageUrl()): string | null {
  const base = bridgeBase();
  if (!base) return null;
  return `${base}/steam/login?return=${encodeURIComponent(returnTo)}`;
}

/** This page, without any query or fragment — the address to come back to. */
function currentPageUrl(): string {
  const { origin, pathname } = window.location;
  return origin + pathname;
}

const MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  'bad-response': 'Steam’s answer didn’t verify, so nothing was connected.',
  'not-verified': 'Steam’s answer didn’t verify, so nothing was connected.',
  unreachable: 'Steam couldn’t be reached to confirm the sign-in. Try again in a moment.',
};

/**
 * Read the result of a sign-in out of the current URL, and scrub it.
 *
 * Returns `null` when there is nothing to read, which is the case on every ordinary page
 * load — this is deliberately cheap and touches no network, so calling it during boot
 * cannot break the offline guarantee.
 */
export function readSteamResult(): SteamAuthOutcome | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash);
  } catch {
    return null;
  }

  const steamId = params.get('steam_id');
  const error = params.get('steam_error');
  if (!steamId && !error) return null;

  clearHash();

  if (steamId) {
    // Verified by the bridge, but check the shape anyway: this arrived through a URL.
    if (!STEAMID.test(steamId)) {
      return { kind: 'failed', message: MESSAGES['bad-response'] };
    }
    return { kind: 'connected', steamId };
  }
  if (error === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'failed', message: MESSAGES[error ?? ''] ?? 'Steam sign-in didn’t complete.' };
}

/** Drop the fragment without adding a history entry or reloading the page. */
function clearHash(): void {
  const { pathname, search } = window.location;
  window.history.replaceState({}, '', pathname + search);
}
