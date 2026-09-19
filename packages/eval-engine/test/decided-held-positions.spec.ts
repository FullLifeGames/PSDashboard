import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { mctsSearch } from '../src/mcts';
import { AUTO_MCTS_FAINTED_FRACTION, battleFaintedFraction, searchPosition } from '../src/search';
import { heldDecided } from '../src/turn-analysis/decided-held';

/**
 * The decided sweep against the bar on real bank positions (round 50): the
 * exported positions of `.calibration/r49-fullkey`, searched the way the
 * bank's auto mode searches them. The raw sweep is asserted too: these
 * positions document what the pair arithmetic names, and the raw field
 * keeps feeding the prover's trigger.
 */
interface BankPosition { id: string; turn: number; serialized: string; p1Won: boolean }

const load = (file: string): BankPosition =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${file}`, import.meta.url), 'utf-8')) as BankPosition;

function search(serialized: string) {
  const battle = positionBattle(createRootPosition(serialized));
  const settings = { depth: 1 as const, samples: 1 as const, tera: false as const };
  return battleFaintedFraction(battle) >= AUTO_MCTS_FAINTED_FRACTION
    ? mctsSearch(serialized, settings)
    : searchPosition(serialized, settings);
}

describe('the decided sweep needs the bar on real positions (round 50)', () => {
  test('749828 t23 (singles): the sweep names Primarina for p1, the bar reads p2, nothing is held', { timeout: 120000 }, () => {
    // Aqua Jet lends its first strike to Primarina's best move while Rillaboom's
    // Grassy Glide goes first under the terrain (T33); the prover proves p2, and p2 won.
    const result = search(load('smogtours-gen9ou-749828-t23.json').serialized);
    expect(result.unanswered?.decided?.side).toBe('p1');
    expect(result.score).toBeLessThan(0);
    expect(heldDecided(result)).toBeUndefined();
  });

  test('2629703929 t6 (doubles): the sweep names Chi-Yu for p1 under a level bar, nothing is held', { timeout: 120000 }, () => {
    const position = load('gen9vgc2026regi-2629703929-t6.json');
    const result = search(position.serialized);
    expect(result.unanswered?.decided).toEqual({ side: 'p1', species: 'Chi-Yu' });
    expect(Math.abs(result.score)).toBeLessThan(0.7);
    expect(heldDecided(result)).toBeUndefined();
    expect(position.p1Won).toBe(false);
  });

  test('2663093831 t12 (doubles): sweep and bar name p2, the sweep is held', { timeout: 120000 }, () => {
    const position = load('gen9doublesou-2663093831-t12.json');
    const result = search(position.serialized);
    expect(result.unanswered?.decided?.side).toBe('p2');
    expect(heldDecided(result)).toEqual(result.unanswered?.decided);
    expect(position.p1Won).toBe(false);
  });
});
