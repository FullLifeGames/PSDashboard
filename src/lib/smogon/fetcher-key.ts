/**
 * Cache identity per custom fetcher: two fakes serving different files must
 * not share an entry. One counter for the usage stats and the set
 * assumptions, so a fetcher has the same identity in both caches.
 */
const fetcherIds = new WeakMap<object, number>();
let nextFetcherId = 1;

export function fetcherKey(fetcher: object | undefined): string {
  if (!fetcher) return 'global';
  let id = fetcherIds.get(fetcher);
  if (id === undefined) {
    id = nextFetcherId++;
    fetcherIds.set(fetcher, id);
  }
  return `custom${id}`;
}
