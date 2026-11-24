import { describe, expect, test, vi } from 'vitest';
import { installStaleChunkReload, STALE_CHUNK_RELOAD_KEY } from '../../../src/lib/stale-chunk-reload';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  };
}

function setup(storage: Storage | null, start = 1_000_000) {
  const target = new EventTarget();
  const reload = vi.fn();
  let clock = start;
  installStaleChunkReload({ target, storage: () => storage, reload, now: () => clock });
  const fail = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { reload, fail, advance: (ms: number) => { clock += ms; } };
}

describe('a lazy chunk that fails to load after a deploy', () => {
  test('reloads the page once and keeps the error from surfacing', () => {
    const storage = memoryStorage();
    const { reload, fail } = setup(storage);
    expect(fail()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STALE_CHUNK_RELOAD_KEY)).toBe('1000000');
  });

  test('a second failure within a minute shows the error instead of reloading again', () => {
    const storage = memoryStorage();
    const first = setup(storage);
    first.fail();
    const second = setup(storage, 1_020_000);
    expect(second.fail()).toBe(false);
    expect(second.reload).not.toHaveBeenCalled();
    second.advance(60_000);
    expect(second.fail()).toBe(true);
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  test('without session storage it never reloads, so no loop can start', () => {
    const { reload, fail } = setup(null);
    expect(fail()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    const throwing = memoryStorage();
    throwing.setItem = () => { throw new Error('storage disabled'); };
    const blocked = setup(throwing);
    expect(blocked.fail()).toBe(false);
    expect(blocked.reload).not.toHaveBeenCalled();
  });
});
