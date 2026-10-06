import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeTurn } from '../src/analysis';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import type { EvalResult, EvalSettings } from '../src/types';
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

const cell = (result: EvalResult, p1: string, p2: string) => {
  const matrix = result.matrix!;
  return matrix.values[matrix.p1Labels.indexOf(p1)][matrix.p2Labels.indexOf(p2)];
};

describe('verify scenes: hidden lengths (round 64, T119)', () => {
  test("2629703929 t8 (VGC): the Sleep Powder cell reads every sleep counter (MC 0.389 ± 0.116; −0.056 through one counter before)", { timeout: 300_000 }, async () => {
    // Chi-Yu falls asleep in a third of the draws for one turn only and wakes into the next (0.96 one ply
    // deeper); the class's first draw slept for three (−0.17) and stood for the whole class.
    const position = scene('gen9vgc2026regi-2629703929-t8');
    const result = await search(position);
    const value = cell(result, 'Heat Wave + Flare Blitz→Groudon', 'Rock Slide + Sleep Powder→Chi-Yu');
    expect(Math.abs(value - 0.3892)).toBeLessThan(2.5 * 0.1156);
    // The side verdicts agreed with the reference before and still do.
    const analysis = flat(position, result);
    expect(analysis.p1.tier).toBe('mistake');
    expect(analysis.p2.tier ?? null).toBeNull();
  });
});
