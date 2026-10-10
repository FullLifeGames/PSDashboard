import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { battleFaintedFraction, searchPosition } from '../src/search';
import { autoTurnSettings } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { heldDecided } from '../src/turn-analysis/decided-held';
import type { EvalSettings } from '../src/types';
import { replayRuleset } from '@fulllifegames/replay-core';

/**
 * The decided sweep against the bar on real bank positions (round 50): the
 * exported positions of `.calibration/r49-fullkey`, searched the way the
 * bank's auto mode searches them (round 67, T114: the app's dispatch, the
 * orchestrated trees with verify and prover at or past the game type's tree
 * threshold, the matrix below it). The raw sweep is asserted too: these
 * positions document what the pair arithmetic names, and the raw field
 * keeps feeding the prover's trigger.
 */
interface BankPosition { id: string; turn: number; serialized: string; p1Won: boolean }

const load = (file: string): BankPosition =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${file}`, import.meta.url), 'utf-8')) as BankPosition;

/** Round 67 (T139): the bench's settings for one position, under its replay's rule set as the bank names it (bankSettings). */
const settingsFor = (position: BankPosition): EvalSettings => ({ depth: 1, samples: 1, tera: false, ruleset: replayRuleset({ id: position.id, log: '' }) });

async function search(position: BankPosition) {
  const settings = settingsFor(position);
  const battle = positionBattle(createRootPosition(position.serialized, settings.ruleset));
  const auto = autoTurnSettings(battleFaintedFraction(battle), battle.gameType === 'doubles');
  return auto.mode === 'mcts'
    ? searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, settings.ruleset), { ...settings, mode: 'mcts' })
    : searchPosition(position.serialized, { ...settings, depth: auto.depth, samples: auto.samples });
}

describe('the decided sweep needs the bar on real positions (round 50)', () => {
  // Round 67 (T139): the bench searches every position with the tables of its replay's rule set, as the bank does.
  test('the bench searches each fixture under the rule set of its replay', () => {
    expect(settingsFor(load('gen9vgc2026regi-2629703929-t6.json')).ruleset).toBe('vgc');
    expect(settingsFor(load('gen9doublesou-2663093831-t12.json')).ruleset).toBe('standard');
    expect(settingsFor(load('smogtours-gen9ou-749828-t23.json')).ruleset).toBe('standard');
  });

  test('749828 t23 (singles): the sweep names Primarina for p1, the bar reads p2, nothing is held', { timeout: 120000 }, async () => {
    // Aqua Jet lends its first strike to Primarina's best move while Rillaboom's
    // Grassy Glide goes first under the terrain (T33); the prover proves p2, and p2 won.
    const result = await search(load('smogtours-gen9ou-749828-t23.json'));
    expect(result.unanswered?.decided?.side).toBe('p1');
    expect(result.score).toBeLessThan(0);
    expect(heldDecided(result)).toBeUndefined();
  });

  test('2629703929 t6 (doubles): the sweep names Chi-Yu for p1 under a level bar, nothing is held', { timeout: 120000 }, async () => {
    const position = load('gen9vgc2026regi-2629703929-t6.json');
    const result = await search(position);
    expect(result.unanswered?.decided).toEqual({ side: 'p1', species: 'Chi-Yu' });
    expect(Math.abs(result.score)).toBeLessThan(0.7);
    expect(heldDecided(result)).toBeUndefined();
    expect(position.p1Won).toBe(false);
  });

  test('2663093831 t12 (doubles): sweep and bar name p2, the sweep is held', { timeout: 120000 }, async () => {
    const position = load('gen9doublesou-2663093831-t12.json');
    const result = await search(position);
    expect(result.unanswered?.decided?.side).toBe('p2');
    expect(heldDecided(result)).toEqual(result.unanswered?.decided);
    expect(position.p1Won).toBe(false);
  });
});
