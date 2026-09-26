/**
 * The last answer the server gave, kept on the phone.
 *
 * The outbox keeps what has not been sent. This keeps what has been read: the customers, the price
 * list, the open orders. Without it, an adviser who reloads in a dead spot gets the app back but
 * every screen empty, because the lists live on the server. With it she gets the screen as it was
 * when she last had a connection, and the app says so rather than passing it off as current.
 *
 * Only used against a hosted project. In the browser demo the database is in the tab, so there is
 * nothing to be cut off from.
 */
const PREFIX = "qirsh.seen.";

export interface Seen<T> {
  data: T;
  at: string;
}

/** A request that never reached the server, as opposed to one the server refused. */
export function isNetworkFailure(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = String((e as Error)?.message ?? e);
  return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i.test(message);
}

export function remember(key: string, data: unknown) {
  try {
    const body = JSON.stringify({ data, at: new Date().toISOString() });
    if (body.length > 400_000) return; // a report that big is not worth the phone's storage
    localStorage.setItem(PREFIX + key, body);
  } catch {
    // Out of room: drop what was read before and keep the newest answer.
    forget();
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, at: new Date().toISOString() }));
    } catch {
      /* the phone will not keep it: the screen simply has nothing to fall back on */
    }
  }
}

export function recall<T>(key: string): Seen<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Seen<T>) : null;
  } catch {
    return null;
  }
}

/** On sign-out: the next person to hold this phone sees nothing of the last one's work. */
export function forget() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
