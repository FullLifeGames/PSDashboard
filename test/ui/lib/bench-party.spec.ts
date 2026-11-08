import { describe, expect, test } from 'vitest';
import type { BranchSimState, BranchSwitchOption, SimPokemonInfo } from '@fulllifegames/eval-engine';
import { limitBench, type Bench } from '../../../src/lib/bench';
import { pokemon } from '../fixtures/sim-state';

/**
 * Round 88 (M3, T314 #55): a battle that already holds only the bodies a side selected needs no filter from the replay's bring
 * list. A turn-0 pick that swaps a never-brought body into the four builds a battle of four (the pinned bring); the replay's own
 * list does not name that body, and filtering by it would drop a body the user picked from the bench.
 */

const option = (species: string, slot: number): BranchSwitchOption => ({ name: species, species, activeSlot: 0, slot, hp: '100/100', hpPercent: 100, fainted: false });
const party = (...names: string[]): SimPokemonInfo[] => names.map(name => pokemon(name));

function stateOf(slots: number, p1Party: SimPokemonInfo[], offered: BranchSwitchOption[]): BranchSimState {
  const bySlot = Array.from({ length: slots }, () => offered.map(entry => ({ ...entry })));
  return {
    p1Switches: bySlot[0], p1SwitchesBySlot: bySlot, p2Switches: bySlot[0], p2SwitchesBySlot: bySlot,
    p1ForceSwitch: false, p1ForceSwitches: [], p2ForceSwitch: false, p2ForceSwitches: [],
    p1Pokemon: p1Party, p2Pokemon: [],
  } as unknown as BranchSimState;
}

describe('limitBench reads the battle\'s own party', () => {
  const bench: Bench = { lists: { p1: ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite'], p2: [] }, rules: { gen: 9 } };
  const picked = [option('Garchomp', 2), option('Flareon', 3), option('Dragonite', 4)];

  test.each([['singles', 1], ['doubles', 2]])('%s: a party of the selection size keeps a picked body the replay never brought', (_, slots) => {
    const state = stateOf(slots, party('Garchomp', 'Flareon', 'Dragonite', 'Kingambit'), picked);
    expect(limitBench(state, bench)).toBe(state);
  });

  test.each([['singles', 1], ['doubles', 2]])('%s: a party larger than the selection still loses its unbrought bodies', (_, slots) => {
    const state = limitBench(stateOf(slots, party('Garchomp', 'Flareon', 'Dragonite', 'Kingambit', 'Gholdengo', 'Heatran'), picked), bench);
    for (const list of state.p1SwitchesBySlot) expect(list.map(entry => entry.species)).toEqual(['Garchomp', 'Dragonite']);
  });
});
