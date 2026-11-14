import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { searchPosition } from '../src/search/position';
import { proveForcedWin } from '../src/endgame/prover';
import { strongerStep } from '../src/endgame/win-paths/stronger';
import { reconstruct } from './arrival-turn';
import { playLineOn, REQUEST, won } from './win-paths-support';

/**
 * Round 89 (#130), step G7a: a stronger play on the lost endgames of the corpus, rebuilt as the engine specs rebuild a game (teams from
 * the log, the bring list for a Champions name). The log-only teams give Keldeo no item, so a mass here is not the app's (the e2e uses
 * the app's own build). Devin's click at 649664 turn 23 is not in the log (Medicham-Mega fell before it moved): the step shows its
 * line without a played comparison.
 */
await loadSimMods('gen9championsou');

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

describe('a stronger play on the corpus', () => {
  test('649664 t23: devin has a choice that wins in more than half of the dice whatever BKC answers, and its line plays to the win', async () => {
    const name = 'smogtours-gen6ou-649664';
    const rebuild = () => reconstruct(name, 23, fixture(name));
    const { runtime } = await rebuild();
    const serialized = serializeLiveBattle(runtime.battleStream.battle!);
    const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: 'standard', tera: true });
    const rootOrder = ranking.perSide.p2.map(row => row.choice);
    const today = proveForcedWin(serialized, { side: 'p2', rootOrder, tera: true, ruleset: 'standard' });
    const step = strongerStep(serialized, REQUEST('p2', { rootOrder, tera: true, ruleset: 'standard' }));
    console.info(`649664 t23 for devin: ${step.line?.label}: wins within ${step.line?.steps.length} steps in ${Math.round((step.chance ?? 0) * 1000) / 10} % of the dice whatever BKC answers (played: none in the log); the production prover reads ${today.mass}`);
    expect(step.status).toBe('found');
    expect(step.played).toBeUndefined();
    expect(step.chance!).toBeGreaterThan(0.5);
    expect(step.chance!).toBeGreaterThanOrEqual(today.mass);
    expect(step.line!.label).toBe('High Jump Kick');
    expect(step.spent.cells).toBeLessThan(600);
    expect(won(await playLineOn((await rebuild()).runtime, step.line!), 'p2')).toBe(true);
  }, 300_000);

  test('Champions VGC 2695803506 t10: juacox300 (doubles 1 v 1), every legal reply of Delphox-Mega is answered inside the budget', async () => {
    const name = 'gen9championsvgc2026regmc-2695803506';
    const { runtime } = await reconstruct(`champions/${name}`, 10, fixture(name));
    const serialized = serializeLiveBattle(runtime.battleStream.battle!);
    const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: 'champions', tera: true });
    const rootOrder = ranking.perSide.p2.map(row => row.choice);
    const step = strongerStep(serialized, REQUEST('p2', { rootOrder, tera: true, ruleset: 'champions' }));
    // no own choice of the burned Kingambit wins within three turns against every reply (Protect, then the burn): the production
    // prover at 100 and 400 cells read mass 0 on this board as well (probe G5), and the step answers every reply inside its budget
    expect(step.status).toBe('none');
    expect(step.chance).toBeUndefined();
    expect(step.line).toBeUndefined();
    expect(step.spent.cells).toBeLessThan(600);
  }, 300_000);
});
