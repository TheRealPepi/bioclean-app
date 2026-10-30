// Last data received from the server, kept in localStorage so the driver
// screens still show something when the phone has no signal. Storage failures
// (private mode, full storage) are ignored: the app just waits for the server.
const PREFIX = "bioclean-cache:";

export function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** On sign-out, so the next person on this phone doesn't see someone else's data. */
export function clearCache(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
