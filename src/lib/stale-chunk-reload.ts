// Every build renames its lazy chunks, so a page built before a deploy asks for chunks that are gone: it reloads once;
// a second failure within the guard shows the error, and without session storage it never reloads, so no loop starts.

export const STALE_CHUNK_RELOAD_KEY = 'ps-replay-interceptor:stale-chunk-reload';
const RELOAD_GUARD_MS = 60_000;

interface StaleChunkReloadDeps {
  target: EventTarget;
  storage: () => Storage | null;
  reload: () => void;
  now: () => number;
}

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
