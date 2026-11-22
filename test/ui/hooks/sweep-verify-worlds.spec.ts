import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { clearWorldPositions, registerWorldPositions, worldPositionsOf } from '../../../src/lib/eval/world-positions';

/**
 * Round 89 (#124): the item-sensitivity probe edits one guessed item of the opposing side and values the edited position. In a
 * short-side game the edit goes into every world's position, so the client blends the probe like the evaluation it softens. A world
 * whose party lacks the edited body (its guess is another body) leaves the probe's blend. The position strings are real
 * serialized shapes (`patchSerializedItem` reads them); the pool is a stand-in that records what it was asked to value.
 */
vi.mock('../../../src/hooks/evaluation/sweep-types', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/hooks/evaluation/sweep-types')>()),
  matchOrPhantom: (result: EvalResult, side: 'p1' | 'p2') => result.perSide[side][1],
}));
const { probeSensitivity } = await import('../../../src/hooks/evaluation/sweep-verify');

const mon = (species: string, item: string) => ({ set: { species, item }, item: item.toLowerCase(), isActive: true });
/** A position of the opposing side P2 holding `species`; P1 is irrelevant to the probe. */
const position = (...species: string[]) => JSON.stringify({ formatid: 'gen9customgame', sides: [{ pokemon: [] }, { pokemon: species.map(name => mon(name, 'Leftovers')) }] });
const itemOf = (serialized: string, species: string) =>
  (JSON.parse(serialized) as { sides: { pokemon: { set: { species: string; item: string } }[] }[] }).sides[1].pokemon.find(entry => entry.set.species === species)?.set.item;

const row = (choice: string, ev: number) => ({ choice, label: choice, worstCase: ev, expected: ev, ev, punishedBy: null });
const result: EvalResult = {
  score: 0, interval: 0, depthCompleted: 1,
  perSide: { p1: [row('move 1', 0.5), row('move 2', 0.1)], p2: [row('move 1', 0.0), row('move 2', -0.1)] },
};

const asked: string[] = [];
const env = () => ({
  params: { rules: { gen: 9 }, sensitivityTargetsFor: () => [{ species: 'Heatran', items: ['Air Balloon'] }] },
  clientRef: { current: { evalPair: vi.fn(async (serialized: string) => { asked.push(serialized); return 0.2; }) } },
}) as never;

beforeEach(() => { asked.length = 0; clearWorldPositions(); });
afterEach(() => clearWorldPositions());

describe('the item-sensitivity probe over the worlds', () => {
  // Doubles and singles share the probe: the patched side is the opposing one and the choice strings are opaque here.
  test.each([['singles', 'Heatran'], ['doubles', 'Heatran']])('%s: the edited item is registered in every world that holds the body', async () => {
    const heaviest = position('Heatran', 'Kingambit');
    const lighter = position('Heatran', 'Ceruledge');
    const absent = position('Corviknight', 'Ceruledge');
    registerWorldPositions([{ position: heaviest, weight: 0.6 }, { position: lighter, weight: 0.3 }, { position: absent, weight: 0.1 }]);
    const out = await probeSensitivity(env(), async () => heaviest, result, null, { depth: 1, samples: 1, tera: false, ruleset: 'vgc' }, null);
    expect(out?.p1?.[0].species).toBe('Heatran');
    const patchedFirst = asked[0];
    expect(itemOf(patchedFirst, 'Heatran')).toBe('Air Balloon');
    const worlds = worldPositionsOf(patchedFirst)!;
    expect(worlds.map(entry => entry.weight)).toEqual([0.6, 0.3]);
    expect(itemOf(worlds[1].position, 'Heatran')).toBe('Air Balloon');
    expect(worldPositionsOf(heaviest)).not.toBeNull();
  });

  test('a position without worlds probes as before and registers nothing', async () => {
    const alone = position('Heatran', 'Kingambit');
    await probeSensitivity(env(), async () => alone, result, null, { depth: 1, samples: 1, tera: false, ruleset: 'vgc' }, null);
    expect(asked.length).toBeGreaterThan(0);
    expect(worldPositionsOf(asked[0])).toBeNull();
  });
});
