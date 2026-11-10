import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { correctActivesFromProtocol } from '../src/branch/corrections';
import { findPokemonOnSide } from '../src/branch/protocol-choices';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, RULES_WITH_DOUBLES, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#138, lane M): the correction repoints every `|switch|` line of a block in order, so a slot that passes through another body
 * inside one block (Ho-Oh knocked out on entry, Ditto replaces it) puts the replaced body off the field for one step. The simulator had
 * played both entries itself: the body that comes back kept everything it holds (Ditto's Imposter Transform in Gen 6 Ubers 902024 turn 23).
 * The correction clears a body it takes off the field (`clearVolatile`, as the simulator's switch does) only when the body does not come
 * back in the same block.
 *
 * Rows: the scene in singles and doubles with Imposter; the control (the body that really leaves is cleared); a sweep over every rule set
 * the corpus plays: every condition of the Dex put on a body, the block passing through a bench body and back leaves the board as it was.
 */
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

/** Every condition of the Dex and every volatile a move sets: the ids a body can carry in `volatiles`. */
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

/**
 * Round 89 (#138, the rest): the correction finds the body of an entry line by the species the line names (`Ditto`). A body that holds a
 * Transform carries the copied species, and a nickname without letters ties by nothing, so the Ditto line of Smogtours Gen 9 RU 887325
 * turn 19 (`|switch|p2a: :)|Ditto, shiny`) was skipped, the line before it (the Breloom that falls on arrival) was the only repoint of the
 * slot, took the simulator's Ditto off the field and cleared its Transform. The lookup now also ties a body by the species it has by the
 * Dex before a transform (`baseSpecies`, the simulator's own field), and prefers that tie to a tie by the copied species.
 */
const nicked = (rules: Rules, species: string, name: string, moves: string[], ability?: string) => {
  const set = mon(rules, { species, moves });
  set.name = name;
  if (ability) set.ability = ability;
  return set;
};

/** A battle whose slot p1a (singles) or p1b (doubles) holds a nicknamed Ditto that Imposter made a copy of the foe `copied`. */
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
    // The Ditto sits first in the party, so a lookup by the current species would hand its line to the transformed Ditto.
    expect(findPokemonOnSide(side, 'Ditto')).toBe(ditto);
    expect(findPokemonOnSide(side, 'Pikachu')).toBe(sparky);
    // The slot passes through Sparky and back to the Ditto: the Ditto stays what the simulator played.
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
    // Round 89 (#141): the log shows a Zoroark under Illusion as `|switch|p1a: Absol|Absol, L50, M`. The lookup of that line gives the real
    // Absol today and the Zoroark never answers to it (its base species is Zoroark): the new tie changes nothing for it.
    const zoroark = nicked(GEN9, 'Zoroark', 'Zoroark', ['splash'], 'Illusion');
    const battle = battleOf(GEN9.singles, [mon(GEN9, { species: 'Pikachu', moves: ['splash'] }), mon(GEN9, { species: 'Absol', moves: ['splash'] }), zoroark], [mon(GEN9, { species: 'Snorlax', moves: ['splash'] })]) as unknown as SimBattle;
    const side = battle.sides[0];
    expect(findPokemonOnSide(side, 'Absol')).toBe(side.pokemon.find(body => body.species.name === 'Absol'));
    expect(findPokemonOnSide(side, 'Zoroark')).toBe(side.pokemon.find(body => body.species.name === 'Zoroark'));
  });
});

describe('the sweep: a body that copied any species of the Dex is still found by the species it has of its own', () => {
  // Imposter and Transform both end in the simulator's `transformInto`; the sweep copies every Dex species onto a Ditto (Imposter) and a Mew
  // (the move Transform) of one side, nicknamed so that no name ties them, and asks the lookup for `Ditto` and `Mew`.
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
      // The simulator stops a battle whose unsent log passes 1,000 lines ("Infinite loop"): a sweep of this size sends none.
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
    // The one species the simulator's `transformInto` refuses to copy (`pokemon.species.name === 'Eternatus-Eternamax'`): no Transform to look up.
    expect(refused).toEqual(['Eternatus-Eternamax']);
  });
});
