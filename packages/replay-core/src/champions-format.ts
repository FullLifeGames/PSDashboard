import { toId } from './ids.ts';

/**
 * Round 75 (T160): the one place that decides whether a format is Pokémon Champions. Four modules decided on their own
 * before (calcModOf, replayRuleset, the spreads' isChampionsFormat, eval-engine's isChampionsSimFormat), with four regexes, and
 * a tier name with its capitals ('[Gen 9 Champions] OU') read as no Champions format in two of them.
 *
 * The input is anything a host holds for a format: the Dex's id ('gen9championsou'), a replay id ('smogtours-gen9championsou-12'),
 * a branch format with custom rules ('gen9championsou@@@+sleepclausemod') or the tier name a log prints ('[Gen 9 Champions] OU',
 * '[Gen 9] Champions VGC 2026 Reg M-A (Bo3)'). The mod's formats all carry its name right after the generation
 * (champions-format.spec.ts checks the rule against every format of the mod and of the base Dex).
 */
const CHAMPIONS_FORMAT = /gen\d+champions/;
const MEMO_LIMIT = 512;
const memo = new Map<string, boolean>();

/** Whether `format` (an id, a replay id, a branch format or a tier name) names a Pokémon Champions format (memoized: the forks of a search ask per node). */
export function isChampionsFormat(format: string): boolean {
  let champions = memo.get(format);
  if (champions === undefined) {
    champions = CHAMPIONS_FORMAT.test(toId(format.split('@@@')[0]));
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(format, champions);
  }
  return champions;
}
