import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadSimMods } from '../src/forward/sim-mods';
import { STRAND_CAP_DOUBLES, STRAND_CAP_SINGLES } from '../src/search/strand-round';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { TIER_THRESHOLDS } from '../src/turn-analysis/types';
import type { EvalCellJob, EvalResult, EvalSettings } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';

/**
 * Round 89 (T322, #59), block 2 stage 3: the strand round on real boards, through the orchestrator. Scenes from the
 * a4p probe (the tree turns the screen found strands in), stored as position fixtures with the played turn:
 * - Champions VGC 2688023429 t2, p1 (doubles, no answer round for the side): the played Protect row's cell holds a 10 percent
 *   burn of Flare Blitz that the verify round priced light; the full search reads it better, and p1's regret falls from a
 *   mistake (0.2) to just under the line. The grade softens in stage 4; stage 3 writes only the record.
 * - VGC 2629760324 t4, p2: a strand in the played row's cell, searched alone; the regret rises, so the grade will ignore it.
 * - Doubles OU 937928 t6 (a side the answer round re-ranked, no passing strand since the seeds of A5): the round asks nothing.
 * - Champions OU singles-6, p2 (singles): a 4 percent kill class past the cover, searched alone; the record is in the same shape.
 * The scores, the matrix, the rankings and the game value of a run equal the run whose strand jobs the executor refuses, field
 * by field, and without the played turn no strand job goes out.
 */
await loadSimMods('gen9championsou');

interface Fixture { serialized: string; tera: boolean; sleepClause: boolean; ruleset: StaticRuleset; keepPlayed: EvalSettings['keepPlayed'] }
const fixture = (name: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/strand/${name}.json`, import.meta.url), 'utf-8')) as Fixture;

interface Run { result: EvalResult; strandJobs: EvalCellJob[]; plainJobs: number }

/** The orchestrated search of a board with the played turn (or without), `refuse` making every strand job fail as a lost worker would. */
async function run(name: string, over: { refuse?: boolean; played?: boolean; prove?: boolean } = {}): Promise<Run> {
  const fx = fixture(name);
  const settings: EvalSettings = {
    depth: 1, samples: 1, mode: 'mcts', tera: fx.tera, sleepClause: fx.sleepClause, ruleset: fx.ruleset,
    ...(over.played === false ? {} : { keepPlayed: fx.keepPlayed }),
    ...(over.prove === false ? { prove: false } : {}),
  };
  const local = createLocalTreeExecutor(fx.serialized, fx.ruleset);
  const out: Run = { result: undefined as unknown as EvalResult, strandJobs: [], plainJobs: 0 };
  const executor = {
    ...local,
    evalCells: async (jobs: EvalCellJob[], onDone?: (completed: number) => void) => {
      out.plainJobs += jobs.filter(job => job.plain).length;
      const strand = jobs.filter(job => job.strands);
      out.strandJobs.push(...strand);
      if (strand.length > 0 && over.refuse) throw new Error('worker lost');
      return local.evalCells(jobs, onDone);
    },
  };
  out.result = await searchTreesOrchestrated(executor, settings);
  return out;
}

const classCount = (jobs: EvalCellJob[]) => jobs.reduce((sum, job) => sum + (job.strands?.length ?? 0), 0);
const SLOW = { timeout: 900_000 };

describe('the strand round on real boards', () => {
  const FLARE = 'p2b:flareblitz>p1a=hit-nokill+brn';

  test('Champions VGC 2688023429 t2: the burn strand of the played row is searched and the record says where the regret ends up', SLOW, async () => {
    const { result, strandJobs } = await run('cv2688023429t2');
    expect(strandJobs.map(job => job.strands)).toEqual([[FLARE]]);
    expect(strandJobs[0].deepen?.depth).toBe(1);
    expect(result.strands?.p2).toBeUndefined();
    const record = result.strands!.p1!;
    expect(record.played).toBe('move luminacrash 1, move protect');
    expect(record.best).toBe('move luminacrash 1, move protect mega');
    expect(record.strands).toHaveLength(1);
    expect(record.strands[0]).toMatchObject({ role: 'P', classKey: FLARE, chance: 0.1 });
    expect(record.strands[0].searched).toBeGreaterThan(record.strands[0].before);
    // The regret crosses the mistake line downwards, which is what stage 4's acquittal reads.
    expect(record.regretBefore).toBeGreaterThanOrEqual(TIER_THRESHOLDS.mistake);
    expect(record.regret).toBeLessThan(TIER_THRESHOLDS.mistake);
    // The record belongs to the grade's pair: the played row is not the first one, the best row is.
    expect(result.perSide.p1[0].choice).toBe(record.best);
  });

  test('o1/o3: the round writes only the record; a lost worker leaves the run without one and otherwise equal, field by field', SLOW, async () => {
    const full = await run('cv2688023429t2');
    const refused = await run('cv2688023429t2', { refuse: true });
    expect(refused.result.strands).toBeUndefined();
    expect(refused.strandJobs.length).toBeGreaterThan(0);
    expect({ ...full.result, strands: undefined }).toEqual(refused.result);
  });

  test('o4: without the played turn no strand job goes out and no record is made', SLOW, async () => {
    const { result, strandJobs } = await run('cv2688023429t2', { played: false });
    expect(strandJobs).toEqual([]);
    expect(result.strands).toBeUndefined();
  });

  test('a sketch pass (prove false, replaced by the full pass) asks for no strand job', SLOW, async () => {
    const { result, strandJobs } = await run('cv2688023429t2', { prove: false });
    expect(strandJobs).toEqual([]);
    expect(result.strands).toBeUndefined();
  });

  test('VGC 2629760324 t4, p2: a strand with no partner goes alone, its record raises the regret, and the cap holds', SLOW, async () => {
    const { result, strandJobs } = await run('vgc2629760324t4');
    expect(classCount(strandJobs)).toBeGreaterThan(0);
    expect(classCount(strandJobs)).toBeLessThanOrEqual(STRAND_CAP_DOUBLES);
    expect(result.strands?.p1).toBeUndefined();
    const record = result.strands!.p2!;
    expect(record.strands.every(strand => strand.role === 'P' || strand.role === 'B')).toBe(true);
    expect(record.regret).toBeGreaterThan(record.regretBefore);
    expect(result.perSide.p2[0].choice).toBe(record.best);
  });

  test('Doubles OU 937928 t6: the answer round ran, no strand passes, nothing goes out', SLOW, async () => {
    const { result, strandJobs, plainJobs } = await run('do937928t6');
    expect(plainJobs).toBeGreaterThan(0);
    expect(strandJobs).toEqual([]);
    expect(result.strands).toBeUndefined();
  });

  test('Champions OU singles-6, p2: a 4 percent kill class past the cover is searched, and the regret falls without leaving its band', SLOW, async () => {
    const { result, strandJobs } = await run('singles6');
    expect(strandJobs.map(job => [job.i, job.j, job.strands])).toEqual([[0, 0, ['hit-kill']]]);
    expect(classCount(strandJobs)).toBeLessThanOrEqual(STRAND_CAP_SINGLES);
    expect(result.strands?.p1).toBeUndefined();
    const record = result.strands!.p2!;
    expect([record.played, record.best]).toEqual(['move kowtowcleave', 'move swordsdance']);
    expect(record.strands).toHaveLength(1);
    expect(record.strands[0]).toMatchObject({ role: 'P', classKey: 'hit-kill', column: 'Defog' });
    expect(record.strands[0].chance).toBeCloseTo(1 / 24, 12);
    expect(record.strands[0].searched).toBeGreaterThan(record.strands[0].before);
    // A move of a few hundredths: the inaccuracy stays an inaccuracy.
    expect(record.regret).toBeLessThan(record.regretBefore);
    expect(record.regret).toBeGreaterThanOrEqual(TIER_THRESHOLDS.inaccuracy);
    expect(result.perSide.p2[0].choice).toBe(record.best);
  });
});
