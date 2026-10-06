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

describe('verify scenes: every class one ply deeper (round 63, T16)', () => {
  test('648453 t13: p1 agrees with the Monte-Carlo reference (inaccuracy 0.118 and 0.119 on two seed blocks; 0.1018 from the first draw before)', { timeout: 300_000 }, async () => {
    // Under the wave's static (T81 without STAB) the note is real: the reference re-prices the same verify
    // cells with 40 fresh draws each, one ply deeper, and keeps the inaccuracy the first draw used to carry alone.
    const position = scene('smogtours-gen6ou-648453-t13');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.tier).toBe('inaccuracy');
    expect(Math.abs(analysis.p1.regret! - 0.118)).toBeLessThan(0.02);
  });

  test('573756 t73: Body Press keeps its inaccuracy (MC 0.1312; three averaged draws lost it in round 62)', { timeout: 300_000 }, async () => {
    const position = scene('smogtours-gen8ou-573756-t73');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.played?.label).toBe('Body Press');
    expect(analysis.p1.tier).toBe('inaccuracy');
  });

  test("912045 t8 (doubles): p1's flat verdict agrees with the Monte-Carlo reference (none, 0.015 and 0.016 on two seed blocks; the first draw's blunder 0.478 before)", { timeout: 300_000 }, async () => {
    // Before, the fallback cell Earth Power + Matcha Gotcha × Earth Power + Tera + Drain Punch read −0.9
    // through its first draw and p1's played Blood Moon line graded a blunder (0.4778). Doubles verify
    // cells now go deeper through their heaviest outcome (the doubles time bound); under the wave's
    // static the reference reads no tier (0.015 and 0.016 on two seed blocks, 24 draws per cell).
    const position = scene('smogtours-gen9doublesou-912045-t8');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.tier ?? null).toBeNull();
    expect(analysis.p1.regret!).toBeLessThan(0.05);
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
