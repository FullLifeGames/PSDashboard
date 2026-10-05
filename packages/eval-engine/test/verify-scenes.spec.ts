import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeTurn } from '../src/analysis';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import type { EvalResult, EvalSettings } from '../src/types';
import type { PlayedTurn } from '../src/played';

/**
 * Round 63 (wave 1, lane C): corpus scenes of the verify step, on positions
 * built like the feedback harness (probe docs/perf/probes/2026-10-05-r63/
 * lanes/C/mc-oracle.vt.ts, EXPORT=1) and searched like the app (four trees,
 * verify, prover). The Monte-Carlo reference is that probe's: every verified
 * cell priced by 40 fresh seeds, each child one ply deeper, per class under
 * the plan weights. Flat verdicts (analyzeTurn without the deep check).
 */

interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: EvalSettings['tera'];
  sleepClause: boolean;
  keepPlayed: EvalSettings['keepPlayed'];
  played: PlayedTurn;
  sacks: Parameters<typeof analyzeTurn>[0]['sacks'];
}

const scene = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Scene;

async function search(position: Scene): Promise<EvalResult> {
  const settings: EvalSettings = {
    depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, keepPlayed: position.keepPlayed ?? undefined,
  };
  return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized), settings);
}

function flat(position: Scene, result: EvalResult) {
  return analyzeTurn({
    turn: position.turn, result, played: position.played, playedOutcome: null,
    scoreBefore: result.score, scoreAfter: null, sacks: position.sacks,
  });
}

const cellValue = (result: EvalResult, p1Label: string, p2Label: string): number => {
  const matrix = result.matrix!;
  const i = matrix.p1Labels.indexOf(p1Label);
  const j = matrix.p2Labels.indexOf(p2Label);
  expect(i, p1Label).toBeGreaterThanOrEqual(0);
  expect(j, p2Label).toBeGreaterThanOrEqual(0);
  return matrix.values[i][j];
};

describe('verify scenes: every class one ply deeper (round 63, T16)', () => {
  test('648453 t13: p1 loses the note only the first draw carried (0.1018 before; MC 0.0832)', { timeout: 300_000 }, async () => {
    const position = scene('smogtours-gen6ou-648453-t13');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.regret!).toBeLessThan(0.1);
    expect(analysis.p1.tier ?? null).toBeNull();
  });

  test('573756 t73: Body Press keeps its inaccuracy (MC 0.1312; three averaged draws lost it in round 62)', { timeout: 300_000 }, async () => {
    const position = scene('smogtours-gen8ou-573756-t73');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.played?.label).toBe('Body Press');
    expect(analysis.p1.tier).toBe('inaccuracy');
  });

  test('912045 t8 (doubles): the fallback cell is priced from all its draws, not the first one (−0.9 before; MC −0.454)', { timeout: 300_000 }, async () => {
    const position = scene('smogtours-gen9doublesou-912045-t8');
    const result = await search(position);
    const value = cellValue(result, 'Earth Power→Okidogi + Matcha Gotcha', 'Earth Power→Ursaluna-Bloodmoon + Tera + Drain Punch→Ursaluna-Bloodmoon');
    // The cell's outcomes spread from −1 to +1: 40 MC draws leave a standard error of 0.111. Inside 2.5 of them.
    expect(Math.abs(value - -0.454)).toBeLessThan(2.5 * 0.111);
  });
});

describe('verify scenes: doubles boundary cells and the played column (round 63, T78)', () => {
  test("2629703929 t13 (VGC): p2's winning Psychic Fangs carries no tier once Flare Blitz's kill odds are priced (0.2618 before)", { timeout: 300_000 }, async () => {
    const position = scene('gen9vgc2026regi-2629703929-t13');
    const analysis = flat(position, await search(position));
    expect(analysis.p2.played?.label).toContain('Psychic Fangs');
    expect(analysis.p2.regret!).toBeLessThan(0.1);
  });
});
