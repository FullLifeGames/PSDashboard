import { afterEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, EvalSettings } from '../src/types';

/**
 * Round 67 (T114): on tree turns the score is the visit mean of the summed
 * trees, not the root's solved game value; in small endgames the two part
 * (doubles-spread-2v1: 0.355 against 0.832, truth 1.0). Until the user
 * decides at the gate the form sits behind a measurement switch:
 * EVAL_TREE_SCORE=visits (today), game (the matrix mode's score: the game
 * value clamped into the maximin interval) or mix (their midpoint). The
 * rankings never move with it.
 */

interface Position { serialized: string; tera: EvalSettings['tera']; sleepClause: boolean; ruleset: StaticRuleset }

const fixture = (name: string): Position =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Position;

const saved = process.env.EVAL_TREE_SCORE;
afterEach(() => {
  if (saved === undefined) delete process.env.EVAL_TREE_SCORE;
  else process.env.EVAL_TREE_SCORE = saved;
});

async function search(position: Position, form?: string): Promise<EvalResult> {
  if (form === undefined) delete process.env.EVAL_TREE_SCORE;
  else process.env.EVAL_TREE_SCORE = form;
  return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, position.ruleset), {
    depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, prove: false,
  });
}

describe('the score form on tree turns (round 67, T114)', () => {
  test('visits keeps today’s score, game reads the clamped game value, mix their midpoint; the rankings stay', { timeout: 180_000 }, async () => {
    const position = fixture('smogtours-gen6ou-649664-t14-g1');
    const visits = await search(position);
    expect(await search(position, 'visits')).toEqual(visits);
    const game = await search(position, 'game');
    expect(visits.gameValue).toBeDefined();
    // The matrix mode's score (ranking/order.ts toResult): the game value clamped into [v1, v2].
    const v1 = Math.max(...visits.perSide.p1.map(row => row.worstCase));
    const v2 = -Math.max(...visits.perSide.p2.map(row => row.worstCase));
    const clamped = Math.min(Math.max(v1, v2), Math.max(Math.min(v1, v2), visits.gameValue!));
    expect(game.score).not.toBe(visits.score);
    expect(game.score).toBeCloseTo(clamped, 12);
    expect(game.perSide).toEqual(visits.perSide);
    const mix = await search(position, 'mix');
    expect(mix.score).toBeCloseTo((visits.score + game.score) / 2, 12);
    expect(mix.perSide).toEqual(visits.perSide);
  });

  test('a typo in the switch throws', async () => {
    await expect(search(fixture('smogtours-gen6ou-649664-t14-g1'), 'games')).rejects.toThrow(/visits, game or mix/);
  });
});
