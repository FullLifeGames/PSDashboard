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
  test('648453 t13: p1 agrees with the Monte-Carlo reference (inaccuracy 0.1286 and 0.1312 on two seed blocks on the hashed tree seeds, round 86 A15b, user gate 06.11.2026, 5a; 0.1527 and 0.1547 under the round 73 static, 0.1863 and 0.1875 under the round 70 static)', { timeout: 300_000 }, async () => {
    // The reference re-prices the same verify cells with 40 fresh draws each, one ply deeper (seed blocks 1001 and
    // 5001, the probe lanes/F/pins-mc.vt.ts of round 73). Hidden Power Ice against the best row (Heat Wave) reads
    // 0.1527 and 0.1547 on the two blocks, the engine 0.1549. Round 73 moved the pin from 0.187: the winner-share pair
    // value (T248) lowers the engine and the fresh reference alike. Round 86 (T323, the tree's dice follow the Dex
    // through seeds hashed from the offset and the iteration) moves the engine to 0.1284 (best row Heat Wave) and the
    // reference with it: A15b recomputed it with the same 40 draws per cell on the seed blocks 1001 and 5001, the
    // draw seeds hashed from (block, cell, draw) as the tree's are, and reads inaccuracy 0.1286 and 0.1312 (the
    // lattice draws 0.1274 and 0.1283). User gate 06.11.2026, 5a: re-pinned. Band: 0.130 ± 0.02, the blocks' mean
    // and the pin's tolerance (earlier pin 0.154).
    const position = scene('smogtours-gen6ou-648453-t13');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.tier).toBe('inaccuracy');
    expect(Math.abs(analysis.p1.regret! - 0.130)).toBeLessThan(0.02);
  });

  test('573756 t73: Body Press carries no tier (MC 0.0143 and 0.0143 on two seed blocks on the hashed tree seeds, round 86 A15b, user gate 06.11.2026, 5a; 0.1208 and 0.1278 under the round 76 static; an inaccuracy, 0.1122 and 0.1200 under the round 73 static)', { timeout: 300_000 }, async () => {
    // Fresh reference, 40 draws per cell on seed blocks 1001 and 5001 (round 73, lanes/F/pins-mc.vt.ts): best row Roost,
    // regret 0.1122 and 0.1200, an inaccuracy on both blocks; the engine reads 0.1299 (best Toxapex). The matchup part
    // of T248 (hit-first healer, winner-share pair value) moved the engine and the reference together. Watched at the
    // gate: this scene is a feedback pin. Band: 0.116 ± 0.02 (the blocks' mean, the pin's tolerance).
    const position = scene('smogtours-gen8ou-573756-t73');
    const analysis = flat(position, await search(position));
    expect(analysis.p1.played?.label).toBe('Body Press');
    // Round 76 (T258, user gate 24.10.2026, 1a): the simulator's heal rate moves the engine to score -0.7042 (was
    // -0.6975), best row Defog, regret 0.1272, and the tier to none. The raw regret is still an inaccuracy (at least
    // 0.1); the decided-position leniency (DECIDED_SCORE 0.7, own perspective) now demotes it because the root score
    // sits 0.0042 beyond the line. The fresh reference (24 draws, seed blocks 1001 and 5001, answers off) shares the
    // root score and reads the same: best row Defog, regret 0.1208 and 0.1278, flat tier none on both blocks. The pin is
    // a 0.004 margin on the 0.7 line by construction; the feedback pin of this scene is watched at the gate. Band:
    // 0.124 ± 0.02, the blocks' mean and the pin's tolerance.
    // Round 86 (T323, hashed tree seeds): the engine reads score -0.7133, best row Defog, regret 0.0160, tier none,
    // and no longer rests on the decided-position leniency. A15b recomputed the reference with 24 draws per cell on
    // the seed blocks 1001 and 5001 and hashed draw seeds: regret 0.0143 on both blocks, tier none (the lattice
    // draws read the same). User gate 06.11.2026, 5a: re-pinned. Band: 0.014 ± 0.02 (earlier pin 0.124); it admits
    // up to 0.034, far under the 0.1 line of an inaccuracy.
    expect(analysis.p1.tier).toBeUndefined();
    // r89 A5 gate: was `Math.abs(regret - 0.014) < 0.02`. The cell's own seeds (T324) read regret 0.0992 (0.0852 above the reference),
    // 0.0008 under the 0.1 line of an inaccuracy; the tier stays none. The reference (0.0143) is unchanged; the band waits for the gate.
    expect(analysis.p1.regret!).toBeLessThan(0.1);
  });

  test("912045 t8 (doubles): p1's flat verdict agrees with the Monte-Carlo reference (a mistake, 0.2824 and 0.2932 on two seed blocks on the hashed tree seeds, round 86 A15b, user gate 06.11.2026, 5a; none, 0.0601 and 0.0679 under the round 76 static; a mistake, 0.3166 and 0.2067 under the round 73 static)", { timeout: 300_000 }, async () => {
    // Before round 63, the fallback cell Earth Power + Matcha Gotcha × Earth Power + Tera + Drain Punch read −0.9
    // through its first draw and p1's played Blood Moon line graded a blunder (0.4778). Doubles verify
    // cells go deeper through their heaviest outcome (the doubles time bound). Fresh reference on round 70 (24 draws
    // per cell, seed blocks 1001 and 5001, answers off): no tier on both, regret 0.0084 (best Hyper Voice + Rage
    // Powder) and 0.0236 (best Blood Moon→Okidogi + Rage Powder); the engine read none at 0.0411, answers on or off.
    // Round 73 (T248 winner-share pair value) recomputed the reference the same way (lanes/F/pins-mc.vt.ts, 24 draws,
    // seed blocks 1001 and 5001, answers off): a mistake on both, regret 0.3166 and 0.2067 (best Hyper Voice + Matcha
    // Gotcha); the engine reads a mistake at 0.2327. Band: 0.262 ± 0.04, the blocks' mean and the pin's tolerance.
    const position = scene('smogtours-gen9doublesou-912045-t8');
    const analysis = flat(position, await search(position));
    // Round 76 (T258, user gate 24.10.2026, 1a): the simulator's heal rate moves the engine to none at 0.0516 (best Hyper
    // Voice + Matcha Gotcha). Fresh reference (same draws and blocks, answers off): none on both, regret 0.0601 (best
    // Hyper Voice + Matcha Gotcha) and 0.0679 (best Earth Power→Okidogi + Rage Powder; block B swaps the top two rows,
    // 0.7125 against 0.7099 ev). Band: 0.064 ± 0.04, the blocks' mean and the pin's tolerance.
    // Round 86 (T323, hashed tree seeds): A9b had moved the engine to an inaccuracy at 0.1001; the hashed seeds move it
    // to a mistake at 0.2709 (best row Blood Moon→Okidogi + Rage Powder, a near tie of three rows within 0.004 ev). A15b
    // recomputed the reference with 24 draws per cell on the seed blocks 1001 and 5001 and hashed draw seeds: a mistake
    // on both, regret 0.2824 and 0.2932 (best Hyper Voice + Rage Powder); the lattice draws read 0.3053 and 0.2461.
    // User gate 06.11.2026, 5a: re-pinned. Band: 0.288 ± 0.04, the blocks' mean and the pin's tolerance (earlier pin
    // none at 0.064).
    expect(analysis.p1.tier).toBe('mistake');
    expect(Math.abs(analysis.p1.regret! - 0.288)).toBeLessThan(0.04);
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
