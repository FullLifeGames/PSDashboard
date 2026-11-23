/** Cache identity per custom fetcher (two fakes serving different files must not share an entry), one counter for stats and sets. */
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
