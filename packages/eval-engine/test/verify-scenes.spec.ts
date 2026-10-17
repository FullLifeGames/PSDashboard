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
  test('648453 t13: p1 agrees with the Monte-Carlo reference (inaccuracy 0.1863 and 0.1875 on two seed blocks under the round 70 static, batch gate; 0.1551 and 0.1568 under the round 69 static)', { timeout: 300_000 }, async () => {
    // The reference re-prices the same verify cells with 40 fresh draws each, one ply deeper (seed blocks 1001 and
    // 5001, the probe lanes/D/pins-mc.vt.ts of round 69 run on round 70). Hidden Power Ice against the best row reads
    // 0.1863 and 0.1875 on the two blocks (best Heat Wave, then Hurricane), the engine 0.1879. Band: 0.187 ± 0.02, the
    // pin's tolerance around the blocks' mean.
    const position = scene('smogtours-gen6ou-648453-t13');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.tier).toBe('inaccuracy');
    expect(Math.abs(analysis.p1.regret! - 0.187)).toBeLessThan(0.02);
  });

  test('573756 t73: Body Press carries no tier (MC none, 0.0774 and 0.0877 on two seed blocks under the round 69 static, user gate 13.10.; inaccuracy 0.1312 before)', { timeout: 300_000 }, async () => {
    // Fresh reference, 40 draws per cell on seed blocks 1001 and 5001: best row → Toxapex, regret 0.077 and 0.088,
    // no tier on either block; the engine reads 0.0891. Band: 0.083 ± 0.02 (the blocks' mean, the pin's tolerance).
    const position = scene('smogtours-gen8ou-573756-t73');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.played?.label).toBe('Body Press');
    expect(analysis.p1.tier ?? null).toBeNull();
    expect(Math.abs(analysis.p1.regret! - 0.083)).toBeLessThan(0.02);
  });

  test("912045 t8 (doubles): p1's flat verdict agrees with the Monte-Carlo reference (none, 0.0084 and 0.0236 on two seed blocks under the round 70 static, batch gate; 0.1465 and 0.1120 under the round 69 static)", { timeout: 300_000 }, async () => {
    // Before round 63, the fallback cell Earth Power + Matcha Gotcha × Earth Power + Tera + Drain Punch read −0.9
    // through its first draw and p1's played Blood Moon line graded a blunder (0.4778). Doubles verify
    // cells go deeper through their heaviest outcome (the doubles time bound). Fresh reference on round 70 (24 draws
    // per cell, seed blocks 1001 and 5001, answers off): no tier on both, regret 0.0084 (best Hyper Voice + Rage
    // Powder) and 0.0236 (best Blood Moon→Okidogi + Rage Powder); the engine reads none at 0.0411, answers on or off.
    // Band: 0.016 ± 0.04, the blocks' mean and the pin's tolerance, with the engine's value inside.
    const position = scene('smogtours-gen9doublesou-912045-t8');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.tier ?? null).toBeNull();
    expect(Math.abs(analysis.p1.regret! - 0.016)).toBeLessThan(0.04);
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
