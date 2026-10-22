import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeTurn } from '../src/analysis';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type { EvalCellJob, EvalCellValue, EvalResult, EvalSettings } from '../src/types';
import type { PlayedTurn } from '../src/played';

/**
 * Round 64 (wave 1.5, lane C, T119): corpus scenes of hidden lengths in the verify step, on positions
 * built like the feedback harness at the wave start (probe docs/perf/probes/2026-10-06-r64/lanes/C/
 * mc-oracle.vt.ts, EXPORT=1) and searched like the app (four trees, verify, prover). The Monte-Carlo
 * reference is that probe's: every verified cell priced by 24 fresh seeds (doubles), each child one ply
 * deeper, per class under the plan weights.
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

const settingsOf = (position: Scene): EvalSettings => ({
  depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, keepPlayed: position.keepPlayed ?? undefined,
});

async function search(position: Scene): Promise<EvalResult> {
  return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized), settingsOf(position));
}

function flat(position: Scene, result: EvalResult) {
  return analyzeTurn({
    turn: position.turn, result, played: position.played, playedOutcome: null,
    scoreBefore: result.score, scoreAfter: null, sacks: position.sacks,
  });
}

/** The verify step's applied value of a blended cell outside the trees: every class one ply deeper under its weight. */
const blendedValue = (value: EvalCellValue) =>
  value.blend!.classes.reduce((sum, cls) => sum + cls.weight * (cls.deepened ?? cls.leafSum / cls.count), 0);

describe('verify scenes: hidden lengths (round 64, T119)', () => {
  test("2629703929 t8 (VGC): the Sleep Powder cell reads every sleep counter (MC 0.585 ± 0.079 under the round 73 static, user gate 22.10.2026, 2a; 0.514 ± 0.093 under the round 70 static)", { timeout: 300_000 }, async () => {
    // Chi-Yu falls asleep in a third of the draws for one turn only and wakes into the next (0.96 one ply
    // deeper); the class's first draw slept for three (−0.17) and stood for the whole class.
    // Round 70 (Protect tempo, batch gate): Protect rows take two of p1's twelve rows and Heat Wave + Flare Blitz→Groudon
    // leaves the list, so the cell is priced through the verify step's own job, Koraidon's Flare Blitz aimed back at
    // Groudon (target 1). Fresh reference (probe docs/perf/probes/2026-10-15-mc/extra-cell-mc.vt.ts, 24 draws on seed
    // blocks 1001 and 5001, answers off): 0.5135 under the classes' weights on both blocks (plain means 0.516 and 0.526,
    // standard errors 0.092 and 0.094). The engine read 0.3981.
    // Round 73 (T248, winner-share pair value; user gate 22.10.2026, 2a): the same cell recomputed (lanes/P/extra-cell-mc.vt.ts,
    // 24 draws on seed blocks 1001 and 5001, answers off): 0.5847 under the classes' weights on both blocks (plain means
    // 0.585 and 0.595, standard errors 0.078 and 0.079; the hit class reads 0.460 against the engine's 0.333, the miss class
    // 1 on both). The engine reads 0.4871. Band: 2.5 standard errors (0.079) around the weighted value, 0.39 to 0.78.
    const position = scene('gen9vgc2026regi-2629703929-t8');
    const local = createLocalTreeExecutor(position.serialized);
    const rounds: EvalCellJob[][] = [];
    const executor: TreeExecutor = { ...local, evalCells: async (jobs, onDone) => { rounds.push(jobs); return local.evalCells(jobs, onDone); } };
    const result = await searchTreesOrchestrated(executor, settingsOf(position));
    const verify = rounds.find(jobs => jobs.length > 0 && jobs.every(job => job.deepen !== undefined && !job.plain))!;
    const template = verify.find(job => job.p1Choice === 'move heatwave, move flareblitz 2' && job.p2Choice === 'move rockslide, move sleeppowder 1')!;
    const [old] = await local.evalCells([{ ...template, p1Choice: 'move heatwave, move flareblitz 1' }], () => {});
    expect(Math.abs(blendedValue(old) - 0.5847)).toBeLessThan(2.5 * 0.079);
    // Round 70 (batch gate, 1a): the engine grades p1's played Heat Wave + Protect an inaccuracy (0.1736, best Heat Wave +
    // Flare Blitz→Jumpluff) and p2's Protect + Encore→Koraidon an inaccuracy (0.1936, best Precipice Blades + Sleep
    // Powder→Chi-Yu), with and without the answer round. The reference on the same rows grades p1 a mistake (0.326 and
    // 0.299 on 24 draws, 0.280 on 96) and p2 none on 24 draws (0.016, 0.010) and an inaccuracy on 96 (0.147); the
    // distance stays open in T242. Under the round 69 static both graded p1 a mistake and p2 no tier.
    // Round 73 (user gate 22.10.2026, 2a): the winner-share pair value lowers both regrets, p1's Heat Wave + Protect to 0.0514
    // (best Heat Wave + Dragon Claw→Jumpluff) and p2's Protect + Encore→Koraidon to 0.0004, so neither carries a tier, with and
    // without the answer round. The fresh reference on the same rows (probe lanes/P/mc-oracle.vt.ts, 24 draws, seed blocks
    // 1001 and 5001, answers off) grades p1 a mistake on both (0.255 and 0.298) and p2 a mistake (0.267) and an inaccuracy
    // (0.168): the engine's distance to it widened from one tier to two on p1, and stays open in T242.
    const analysis = flat(position, result);
    expect(analysis.p1.tier ?? null).toBeNull();
    expect(analysis.p2.tier ?? null).toBeNull();
    const saved = process.env.EVAL_DOUBLES_ANSWERS;
    process.env.EVAL_DOUBLES_ANSWERS = 'off';
    try {
      const listed = flat(position, await search(position));
      expect(listed.p1.tier ?? null).toBeNull();
      expect(listed.p2.tier ?? null).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.EVAL_DOUBLES_ANSWERS;
      else process.env.EVAL_DOUBLES_ANSWERS = saved;
    }
  });
});
