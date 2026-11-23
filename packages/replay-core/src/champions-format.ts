import { toId } from './ids.ts';

/** The one rule that decides whether a format is Pokémon Champions: no format of the base Dex carries the word `champions` and every format of the mod does. */
const CHAMPIONS_FORMAT = /champions/;
const MEMO_LIMIT = 512;
const memo = new Map<string, boolean>();

/** Whether `format` (a Dex id, replay id, branch format with custom rules or a logged tier name) names a Pokémon Champions format; memoized because a search asks per node. */
export function isChampionsFormat(format: string): boolean {
  let champions = memo.get(format);
  if (champions === undefined) {
    champions = CHAMPIONS_FORMAT.test(toId(format.split('@@@')[0]));
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(format, champions);
  }
  return champions;
}
