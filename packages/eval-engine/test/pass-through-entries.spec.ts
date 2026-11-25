import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { correctActivesFromProtocol } from '../src/branch/corrections';
import { findPokemonOnSide } from '../src/branch/protocol-choices';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, RULES_WITH_DOUBLES, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championsou');

const GEN9: Rules = RULES.find(rules => rules.name === 'Gen 9')!;
const line = (kind: 'switch' | 'drag', slot: string, name: string) => `|${kind}|${slot}: ${name}|${name}, F|100/100`;

function sceneOf(mode: Mode): { battle: Battle; ditto: Battle['sides'][0]['pokemon'][number]; slot: string } {
  const ditto = mon(GEN9, { species: 'Ditto', moves: ['transform'] });
  ditto.ability = 'Imposter';
  const lead = mode === 'singles' ? [ditto, mon(GEN9, { species: 'Pikachu', moves: ['splash'] })] : [mon(GEN9, { species: 'Blissey', moves: ['splash'] }), ditto, mon(GEN9, { species: 'Pikachu', moves: ['splash'] })];
  const foes = [mon(GEN9, { species: 'Snorlax', moves: ['splash'] })];
  if (mode === 'doubles') foes.push(mon(GEN9, { species: 'Chansey', moves: ['splash'] }));
  const battle = battleOf(mode === 'singles' ? GEN9.singles : GEN9.doubles!, lead, foes);
  const body = battle.sides[0].pokemon.find(pokemon => pokemon.name === 'Ditto')!;
  return { battle, ditto: body, slot: mode === 'singles' ? 'p1a' : 'p1b' };
}

describe.each(['singles', 'doubles'] as const)('a slot that passes through another body and back keeps the body the simulator played (%s)', mode => {
  test('Ditto keeps its Imposter Transform', () => {
    const { battle, ditto, slot } = sceneOf(mode);
    expect(ditto.transformed, 'the scene: Imposter fired at the lead').toBe(true);
    const before = Object.keys(ditto.volatiles).sort();
    correctActivesFromProtocol(battle as SimBattle, [line('switch', slot, 'Pikachu'), line('switch', slot, 'Ditto')]);
    expect(battle.sides[0].active['abc'.indexOf(slot[2])]).toBe(ditto);
    expect(ditto.transformed).toBe(true);
    expect(Object.keys(ditto.volatiles).sort()).toEqual(before);
  });

  test('a drag back keeps it too', () => {
    const { battle, ditto, slot } = sceneOf(mode);
    correctActivesFromProtocol(battle as SimBattle, [line('switch', slot, 'Pikachu'), line('drag', slot, 'Ditto')]);
    expect(ditto.transformed).toBe(true);
  });

  test('a body that does not come back loses it, as the simulator\'s switch does', () => {
    const { battle, ditto, slot } = sceneOf(mode);
    correctActivesFromProtocol(battle as SimBattle, [line('switch', slot, 'Pikachu')]);
    expect(battle.sides[0].active['abc'.indexOf(slot[2])]).toBe(battle.sides[0].pokemon.find(pokemon => pokemon.name === 'Pikachu'));
    expect(ditto.transformed).toBe(false);
    expect(Object.keys(ditto.volatiles)).toEqual([]);
  });
});

function conditionIds(battle: Battle): string[] {
  const ids = new Set(Object.keys((battle.dex.data as unknown as { Conditions: object }).Conditions));
  for (const move of battle.dex.moves.all()) if (move.volatileStatus) ids.add(move.volatileStatus);
  return [...ids];
}

interface Row { rules: Rules; mode: Mode; slot: number }
const ROWS: Row[] = [
  ...RULES.map((rules): Row => ({ rules, mode: 'singles', slot: 0 })),
  ...RULES_WITH_DOUBLES.flatMap((rules): Row[] => [{ rules, mode: 'doubles', slot: 0 }, { rules, mode: 'doubles', slot: 1 }]),
];

function twin(rules: Rules, mode: Mode): Battle {
  const side = (species: string[]) => species.map(name => mon(rules, { species: name, moves: ['Splash'] }));
  return battleOf(mode === 'singles' ? rules.singles : rules.doubles!, side(['Snorlax', 'Pikachu', 'Chansey', 'Raichu']), side(['Snorlax', 'Pikachu', 'Chansey', 'Raichu']));
}

describe('the sweep: a block that passes through a bench body and back leaves the board as it was', () => {
  test.each(ROWS.map(row => [`${row.rules.name} ${row.mode} slot ${'ab'[row.slot]}`, row] as const))('%s', (_label, { rules, mode, slot }) => {
    const board = twin(rules, mode);
    const carried = conditionIds(board);
    expect(carried.length).toBeGreaterThan(20);
    const body = board.sides[1].active[slot]!;
    for (const id of carried) body.volatiles[id] = board.initEffectState({ id, target: body });
    body.boosts.atk = 2;
    body.lastMove = board.dex.moves.get('splash') as never;
    for (const slotOfMove of body.moveSlots) slotOfMove.disabled = true;
    const bench = board.sides[1].pokemon[mode === 'singles' ? 1 : 2];
    const ident = `p2${'ab'[slot]}`;

    const keys = Object.keys(body.volatiles).sort();
    const order = board.sides[1].pokemon.map(pokemon => pokemon.name);
    correctActivesFromProtocol(board as SimBattle, [line('switch', ident, bench.name), line('switch', ident, body.name)]);

    expect(board.sides[1].active[slot]).toBe(body);
    expect(board.sides[1].pokemon.map(pokemon => pokemon.name)).toEqual(order);
    expect(Object.keys(body.volatiles).sort()).toEqual(keys);
    expect(body.boosts.atk).toBe(2);
    expect(body.lastMove?.id).toBe('splash');
    expect(body.moveSlots.every(slotOfMove => slotOfMove.disabled)).toBe(true);
    expect([body.isActive, body.position]).toEqual([true, slot]);
  });
});

const nicked = (rules: Rules, species: string, name: string, moves: string[], ability?: string) => {
  const set = mon(rules, { species, moves });
  set.name = name;
  if (ability) set.ability = ability;
  return set;
};

function transformedScene(mode: Mode, copied: string, benchName: string) {
  const ditto = nicked(GEN9, 'Ditto', ':)', ['transform'], 'Imposter');
  const bench = [nicked(GEN9, 'Pikachu', benchName, ['splash'])];
  const lead = mode === 'singles' ? [ditto, ...bench] : [mon(GEN9, { species: 'Blissey', moves: ['splash'] }), ditto, ...bench];
  const foes = [mon(GEN9, { species: copied, moves: ['splash'] })];
  if (mode === 'doubles') foes.push(mon(GEN9, { species: 'Chansey', moves: ['splash'] }));
  const battle = battleOf(mode === 'singles' ? GEN9.singles : GEN9.doubles!, lead, foes) as unknown as SimBattle;
  const side = battle.sides[0];
  return { battle, side, ditto: side.pokemon.find(body => body.name === ':)')!, slot: mode === 'singles' ? 'p1a' : 'p1b', at: mode === 'singles' ? 0 : 1 };
}

describe.each(['singles', 'doubles'] as const)('a nicknamed Ditto that holds a Transform is found by its entry line (%s)', mode => {
  test('the block that passes through another body and back keeps the transformed Ditto', () => {
    const { battle, side, ditto, slot, at } = transformedScene(mode, 'Snorlax', 'Sparky');
    expect(ditto.transformed, 'the scene: Imposter fired at the lead').toBe(true);
    expect(ditto.species.name, 'the copy').toBe('Snorlax');
    const before = Object.keys(ditto.volatiles).sort();
    correctActivesFromProtocol(battle, [`|switch|${slot}: Sparky|Pikachu, F|100/100`, `|switch|${slot}: :)|Ditto, F|100/100`]);
    expect(side.active[at]).toBe(ditto);
    expect(ditto.transformed).toBe(true);
    expect(ditto.species.name).toBe('Snorlax');
    expect(Object.keys(ditto.volatiles).sort()).toEqual(before);
  });

  test('the copied species is also on the bench: each line finds its own body', () => {
    const { battle, side, ditto, slot, at } = transformedScene(mode, 'Pikachu', 'Sparky');
    const sparky = side.pokemon.find(body => body.name === 'Sparky')!;
    expect(ditto.species.name, 'the scene: a Ditto that looks like the Pikachu beside it').toBe('Pikachu');
    expect(findPokemonOnSide(side, 'Ditto')).toBe(ditto);
    expect(findPokemonOnSide(side, 'Pikachu')).toBe(sparky);
    correctActivesFromProtocol(battle, [`|switch|${slot}: Sparky|Pikachu, F|100/100`, `|switch|${slot}: :)|Ditto, F|100/100`]);
    expect(side.active[at]).toBe(ditto);
    expect(ditto.transformed).toBe(true);
  });

  test('a Pikachu that really comes in takes the slot from the transformed Ditto and clears it', () => {
    const { battle, side, ditto, slot, at } = transformedScene(mode, 'Pikachu', 'Sparky');
    correctActivesFromProtocol(battle, [`|switch|${slot}: Sparky|Pikachu, F|100/100`]);
    expect(side.active[at]).toBe(side.pokemon.find(body => body.name === 'Sparky'));
    expect(ditto.transformed).toBe(false);
    expect(ditto.species.name).toBe('Ditto');
  });
});

describe('a body that is not a Ditto is looked up as before', () => {
  test('an Illusion body on the bench does not take the line of the species it shows (Absol)', () => {
    const zoroark = nicked(GEN9, 'Zoroark', 'Zoroark', ['splash'], 'Illusion');
    const battle = battleOf(GEN9.singles, [mon(GEN9, { species: 'Pikachu', moves: ['splash'] }), mon(GEN9, { species: 'Absol', moves: ['splash'] }), zoroark], [mon(GEN9, { species: 'Snorlax', moves: ['splash'] })]) as unknown as SimBattle;
    const side = battle.sides[0];
    expect(findPokemonOnSide(side, 'Absol')).toBe(side.pokemon.find(body => body.species.name === 'Absol'));
    expect(findPokemonOnSide(side, 'Zoroark')).toBe(side.pokemon.find(body => body.species.name === 'Zoroark'));
  });
});

describe('the sweep: a body that copied any species of the Dex is still found by the species it has of its own', () => {
  test('every species of the Dex as the copy', () => {
    const lead = [nicked(GEN9, 'Ditto', ':)', ['transform'], 'Imposter'), nicked(GEN9, 'Mew', ':(', ['transform']), mon(GEN9, { species: 'Pikachu', moves: ['splash'] })];
    const battle = battleOf(GEN9.doubles!, lead, [mon(GEN9, { species: 'Snorlax', moves: ['splash'] }), mon(GEN9, { species: 'Chansey', moves: ['splash'] })]) as unknown as SimBattle;
    const side = battle.sides[0];
    const [ditto, mew] = [side.pokemon[0], side.pokemon[1]];
    const foe = battle.sides[1].active[0]!;
    const species = battle.dex.species.all().filter(entry => entry.exists);
    expect(species.length).toBeGreaterThan(1000);
    const wrong: string[] = [];
    const refused: string[] = [];
    for (const entry of species) {
      foe.setSpecies(entry);
      // The simulator stops a battle whose unsent log passes 1,000 lines ("Infinite loop"): a sweep sends none.
      battle.sentLogPos = battle.log.length;
      for (const body of [ditto, mew]) {
        body.clearVolatile();
        body.transformInto(foe);
      }
      if (ditto.species.name !== entry.name || mew.species.name !== entry.name) {
        refused.push(entry.name);
        continue;
      }
      if (findPokemonOnSide(side, 'Ditto') !== ditto) wrong.push(`${entry.name}: Ditto`);
      if (findPokemonOnSide(side, 'Mew') !== mew) wrong.push(`${entry.name}: Mew`);
    }
    expect(wrong).toEqual([]);
    // The simulator's `transformInto` refuses Eternatus-Eternamax: no Transform to look up.
    expect(refused).toEqual(['Eternatus-Eternamax']);
  });
});
