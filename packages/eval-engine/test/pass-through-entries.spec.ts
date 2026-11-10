import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { correctActivesFromProtocol } from '../src/branch/corrections';
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
