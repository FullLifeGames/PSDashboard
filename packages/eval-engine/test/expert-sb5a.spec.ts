import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor } from '../src/search';
import { loadSimMods } from '../src/forward/sim-mods';
import type { EvalResult, EvalSettings } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';

// Expert pin: Dragapult against Gholdengo; `forced` is the pivot request, `turn2` the board after Glimmora came in.
// Margins: turn 2 Earth Power -0.193 vs Stealth Rock -0.243; replacement Great Tusk -0.121 vs Lokix -0.142.

await loadSimMods('gen9customgame');

interface Fixture { settings: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; turn2: string; forced: string }
const scene = JSON.parse(readFileSync(new URL('./fixtures/sb-gholdengo.json', import.meta.url), 'utf-8')) as Fixture;

const settings: EvalSettings = {
  depth: 1, samples: 3, mode: 'matrix', tera: scene.settings.tera, sleepClause: scene.settings.sleepClause, ruleset: scene.settings.ruleset, prove: false,
};
const search = (serialized: string): Promise<EvalResult> => searchOrchestrated(createLocalExecutor(serialized, scene.settings.ruleset), settings);
const mixOf = (result: EvalResult, side: 'p1' | 'p2'): [string, number][] => {
  const matrix = result.matrix!;
  const labels = side === 'p1' ? matrix.p1Labels : matrix.p2Labels;
  const mix = side === 'p1' ? matrix.mixes!.p1 : matrix.mixes!.p2;
  return labels.map((label, index) => [label, mix[index]] as [string, number]).filter(([, weight]) => weight > 0.01);
};

describe('the shared Gholdengo game, Tera off', () => {
  test('the fixture is the user\'s scene: Gholdengo at -1 Special Attack, free to switch, Glimmora in front', async () => {
    expect(scene.settings.tera).toBe(false);
    const { deserializeBattleExact } = await import('../src/forward-model');
    const battle = deserializeBattleExact(scene.turn2);
    const gholdengo = battle.sides[1].active[0];
    expect(gholdengo.species.name).toBe('Gholdengo');
    expect(gholdengo.boosts.spa).toBe(-1);
    expect(battle.sides[0].active[0].species.name).toBe('Glimmora');
  });

  test('turn 2: Earth Power leads for p1 and Gholdengo\'s mix is Make It Rain', async () => {
    const result = await search(scene.turn2);
    expect(result.perSide.p1[0].label).toBe('Earth Power');
    expect(mixOf(result, 'p2').map(([label]) => label)).toEqual(['Make It Rain']);
    expect(mixOf(result, 'p2')[0][1]).toBeGreaterThan(0.9);
  }, 120_000);

  test('the replacement after U-turn is Great Tusk', async () => {
    const result = await search(scene.forced);
    expect(result.perSide.p1[0].label).toBe('→ Great Tusk');
    expect(result.depthCompleted).toBe(2);
    expect(mixOf(result, 'p1').map(([label]) => label)).toEqual(['→ Great Tusk']);
    expect(result.perSide.p1[0].ev - result.perSide.p1[1].ev).toBeGreaterThan(0.015);
  }, 120_000);
});
