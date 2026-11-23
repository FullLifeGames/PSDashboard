import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor } from '../src/search';
import { loadSimMods } from '../src/forward/sim-mods';
import type { EvalResult, EvalSettings } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';

/**
 * Expert pin SB5a: the shared new game, Gen 9 OU, Bene (p1) against bab 23 (p2), a variation from turn 1: Dragapult (Choice
 * Specs) against Gholdengo (Choice Scarf). Gholdengo moves first, Make It Rain takes Dragapult to 56 and drops Gholdengo to -1
 * Special Attack, U-turn takes Gholdengo 315 to 301, and p1 picks the replacement. The fixture holds the open pivot request
 * (`forced`) and the board after Glimmora came in (`turn2`).
 *
 * The user's reading, Tera off (with Tera on Glimmora leads, Tera Ground Earth Power takes Gholdengo in 300 of 300 seeded races):
 *  1. Turn 2, Glimmora against the locked Gholdengo: Earth Power leads for p1 and Gholdengo's mix is Make It Rain. Gholdengo's
 *     -1 Special Attack is no handicap, because it loses the stage the moment it switches out.
 *  2. The replacement after U-turn: Great Tusk, not Glimmora (Glimmora meets a Gholdengo that beats it).
 * Both rows run the app's road for a singles turn before a quarter of the bodies fell: the matrix at depth 1 with 3 samples.
 * Margins: turn 2, Earth Power -0.193 against Stealth Rock -0.243 (0.050), Gholdengo's Make It Rain 0.225 against a Dragonite
 * switch 0.217, mix 100 % Make It Rain. The replacement, judged by the turn after it: Great Tusk -0.121 against Lokix -0.142
 * (0.021), Pawmot -0.157, Meowscarada -0.162, Glimmora -0.193 last; the solved mix is 100 % Great Tusk, no tie and no tie-break.
 */

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

describe('SB5a: the shared Gholdengo game, Tera off', () => {
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
    // The turn after each replacement is searched, so Great Tusk leads on its own and holds the whole mix (without it four
    // bodies tie and a one-ply tie-break decides).
    expect(result.depthCompleted).toBe(2);
    expect(mixOf(result, 'p1').map(([label]) => label)).toEqual(['→ Great Tusk']);
    expect(result.perSide.p1[0].ev - result.perSide.p1[1].ev).toBeGreaterThan(0.015);
  }, 120_000);
});
