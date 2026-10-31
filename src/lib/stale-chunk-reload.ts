/**
 * Round 81 (T298): every build renames its lazy chunks, and a deploy replaces the old ones, so a page built before
 * the deploy (an open tab, or an index.html the browser kept) asks for chunks that are gone. Production, 31.10.2026:
 * "Error loading .../assets/opponent-inferrer-DmwVZADz.js" until a hard reload. Vite's preload helper raises
 * `vite:preloadError` for a failed lazy import; the page reloads once to fetch the new index.html. A second failure
 * within the guard shows the error, and without session storage the page never reloads, so no loop can start.
 */

export const STALE_CHUNK_RELOAD_KEY = 'ps-replay-interceptor:stale-chunk-reload';
const RELOAD_GUARD_MS = 60_000;

interface StaleChunkReloadDeps {
  target: EventTarget;
  storage: () => Storage | null;
  reload: () => void;
  now: () => number;
}

/** Marks the reload in session storage; false when the storage is missing or refuses the write. */
function markReload(storage: Storage | null, at: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(STALE_CHUNK_RELOAD_KEY) ?? Number.NaN);
    if (Number.isFinite(last) && at - last < RELOAD_GUARD_MS) return false;
    storage.setItem(STALE_CHUNK_RELOAD_KEY, String(at));
    return true;
  } catch {
    return false;
  }
}

export function installStaleChunkReload(deps: StaleChunkReloadDeps): void {
  deps.target.addEventListener('vite:preloadError', event => {
    if (!markReload(deps.storage(), deps.now())) return;
    event.preventDefault();
    deps.reload();
  });
}

/** The app's own wiring: the window, its session storage and a plain reload. */
export function installStaleChunkReloadOnWindow(): void {
  installStaleChunkReload({
    target: window,
    storage: () => {
      try {
        return window.sessionStorage;
      } catch {
        return null;
      }
    },
    reload: () => window.location.reload(),
    now: () => Date.now(),
  });
}
