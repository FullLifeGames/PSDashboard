import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { proveForcedWin } from '../src/endgame/prover';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { TeraAllowance } from '../src/types';

/**
 * Round 89 (A5f-7, ruling 23): the prover asks the full proof for the root candidates the ranking names, three of them, and no
 * longer gates them on a greedy five-turn line. A5f-6 measured the greedy line: it missed 8 to 20 % of the doubles proofs the
 * full proof finds (one to three turns long, all for the side that won), because one 16-cell allowance served its three
 * candidates and a doubles root has 6 to 16 replies; singles missed none. The four doubles scenes below are A5f-6's miss list at
 * the production budget: no proof before, mass 1 after. `rootOrder` is the three candidates the search ranked first (the probe's
 * record), so the call is the app's. The two singles scenes keep a singles proof as it was (the round 35 positions of
 * 749351 and 749828), so one rule serves both game types. The four doubles scenes live in fixtures/forced-win/, outside
 * fixtures/positions/, because the speed-layer sweeps (`loadPositions`) read every file there and the Champions scenes need
 * their mod loaded first.
 */
interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: TeraAllowance;
  sleepClause: boolean;
  ruleset?: StaticRuleset;
  side: 'p1' | 'p2';
  rootOrder: string[];
}
const scene = (name: string, folder: 'forced-win' | 'positions' = 'forced-win') =>
  JSON.parse(readFileSync(new URL(`./fixtures/${folder}/${name}.json`, import.meta.url), 'utf-8')) as Scene;

const prove = (board: Scene) =>
  proveForcedWin(board.serialized, { side: board.side, rootOrder: board.rootOrder ?? [], tera: board.tera ?? false, sleepClause: board.sleepClause, ruleset: board.ruleset });

describe('the forced-win proof without the greedy scout (round 89, A5f-7)', () => {
  const misses: Array<[string, string, number]> = [
    ['Doubles OU 2661746817 turn 8', 'scout-miss-gen9doublesou-2661746817-t8', 1],
    ['VGC 2024 Reg G 2163312677 turn 8', 'scout-miss-gen9vgc2024regg-2163312677-t8', 1],
    ['Champions VGC 2694684816 turn 8', 'scout-miss-gen9championsvgc2026regmc-2694684816-t8', 3],
    ['Champions VGC 2682637901 turn 6 (Bo3)', 'scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 2],
  ];
  test.each(misses)('doubles, %s: the proof the scout missed reads mass 1', async (_title, name, turns) => {
    const board = scene(name);
    await loadSimMods(board.ruleset === 'champions' ? 'gen9championsdoublescustomgame' : 'gen9doublescustomgame');
    const proof = prove(board);
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(turns);
    expect(proof.caveat).toBe('sampled-rolls');
  });

  test.each([
    ['smogtours-gen9ou-749351-t10', 'p1', 1, 'none'],
    ['smogtours-gen9ou-749828-t23', 'p2', 1, 'barring-crit'],
  ] as const)('singles, %s: the proof for %s stays mass 1 in %i turn', (name, side, turns, caveat) => {
    const proof = prove({ ...scene(name, 'positions'), side, rootOrder: [] });
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(turns);
    expect(proof.caveat).toBe(caveat);
  });
});
