import { toId } from './ids.ts';

// No format of the base Dex carries the word `champions`; every format of the mod does.
const CHAMPIONS_FORMAT = /champions/;
const MEMO_LIMIT = 512;
const memo = new Map<string, boolean>();

/** Whether `format` (Dex id, replay id, branch format or logged tier name) names a Pokémon Champions format. */
export function isChampionsFormat(format: string): boolean {
  let champions = memo.get(format);
  if (champions === undefined) {
    champions = CHAMPIONS_FORMAT.test(toId(format.split('@@@')[0]));
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(format, champions);
  }
  return champions;
}
