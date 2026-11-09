import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import type { PokemonSnapshot, TurnSnapshot } from '@fulllifegames/replay-core';
import { correctActivesFromProtocol, correctBattleFromSnapshot } from '../src/branch/corrections';
import { openSession, startBattle, waitForBattle } from '../src/branch/runtime-session';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, RULES_WITH_DOUBLES, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#138): the game's switch-out ends a body's volatiles. Two corrections of the rebuild differed from the simulator's own switch.
 *
 * 1. A body the simulator switched out and the game dragged back into the OTHER slot (Doubles OU 2553498001 turn 5: Sableye, taunted,
 *    leaves p2b for Rillaboom; Roar on p2a drags it into p2a) got the volatiles of its exit back. The check for a switch-out in the block
 *    asked about the slot the body entered, not the slot it left.
 * 2. The body a correction displaces from a slot kept its volatiles on the bench (Champions VGC 2685328963: Sableye kept its Taunt and
 *    entered turn 7 with it). The simulator's switch calls `clearVolatile` on the old active.
 *
 * Rows: the scenes on the simulator in doubles (1) and in singles and doubles (2), both correction paths (the protocol's lines and the
 * snapshot); then a sweep over every rule set the corpus plays (Gens 1 to 9 and Champions, singles and doubles): every condition of the
 * Dex put on a body as a volatile, the simulator's own switch on one board and the correction on its twin, the same volatiles after.
 */
await loadSimMods('gen9championsou');

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, ability: string, moves: string[], item = ''): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', evs, ivs, level: 100,
});

const ids = (battle: SimBattle, side: 0 | 1, name: string) => Object.keys(battle.sides[side].pokemon.find(pokemon => pokemon.name === name)!.volatiles).sort();
const bodyOf = (battle: SimBattle, side: 0 | 1, name: string) => battle.sides[side].pokemon.find(pokemon => pokemon.name === name)!;

async function open(format: string, p1: PokemonSet[], p2: PokemonSet[]) {
  const session = openSession({ format, p1Team: p1, p2Team: p2, replayLog: '', targetTurn: 9 }, Date.now() + 60_000);
  await startBattle(session, p1, p2);
  return { session, battle: session.battleStream.battle! };
}

async function toTurn(session: Awaited<ReturnType<typeof open>>['session'], turn: number) {
  await waitForBattle(session, current => current.turn >= turn);
}

describe('a body the game dragged into the other slot after its switch-out (doubles)', () => {
  const p1 = [set('Pikachu', 'Static', ['Taunt', 'Splash']), set('Snorlax', 'Immunity', ['Splash'])];
  const p2 = [set('Ogerpon', 'Defiant', ['Tackle', 'Splash']), set('Sableye', 'Prankster', ['Tackle', 'Splash']), set('Rillaboom', 'Overgrow', ['Splash']), set('Pidgey', 'Keen Eye', ['Splash'])];
  // Turn 1: Taunt lands on Sableye (p2b). Turn 2: it switches out for Rillaboom in the simulator.
  const turn1 = '>p1 move 1 2, move 1\n>p2 move 1 1, move 1 1';
  const turn2 = '>p1 move 2, move 1\n>p2 move 1 1, switch 3';
  // The game: Rillaboom takes p2b, then Roar drags Sableye into p2a.
  const events = ['|switch|p2b: Rillaboom|Rillaboom, M|100/100', '|drag|p2a: Sableye|Sableye, M|100/100'];

  async function scene(): Promise<SimBattle> {
    const { session, battle } = await open('gen9doublescustomgame', p1, p2);
    session.writeSim(turn1);
    await toTurn(session, 2);
    expect(ids(battle, 1, 'Sableye')).toContain('taunt');
    session.writeSim(turn2);
    await toTurn(session, 3);
    expect(bodyOf(battle, 1, 'Sableye').isActive).toBe(false);
    return battle;
  }

  test('the protocol path brings it back without the Taunt its switch-out ended', async () => {
    const battle = await scene();
    correctActivesFromProtocol(battle, events);
    expect(battle.sides[1].active[0]).toBe(bodyOf(battle, 1, 'Sableye'));
    expect(ids(battle, 1, 'Sableye')).toEqual([]);
  });

  test('a body that re-enters the slot it left still starts fresh', async () => {
    const battle = await scene();
    // The game: Rillaboom takes p2b, is knocked out, and Sableye comes back to p2b.
    correctActivesFromProtocol(battle, ['|switch|p2b: Rillaboom|Rillaboom, M|100/100', '|faint|p2b: Rillaboom', '|switch|p2b: Sableye|Sableye, M|100/100']);
    expect(ids(battle, 1, 'Sableye')).toEqual([]);
  });

  test('a body the game kept on its slot gets the volatiles the guessed exit took (one entry, no other body left)', async () => {
    const battle = await scene();
    // The game never switched Sableye out: its one entry line is the protocol's own switch-in, with nobody leaving before it.
    correctActivesFromProtocol(battle, ['|switch|p2b: Sableye|Sableye, M|100/100']);
    expect(battle.sides[1].active[1]).toBe(bodyOf(battle, 1, 'Sableye'));
    expect(ids(battle, 1, 'Sableye')).toContain('taunt');
  });
});

function snapshotFrom(truth: SimBattle, log: string[], active: Record<string, string[]>): TurnSnapshot {
  const side = (index: 0 | 1) => ({
    name: truth.sides[index].name,
    id: truth.sides[index].id as 'p1' | 'p2',
    sideConditions: {},
    pokemon: truth.sides[index].pokemon.map((pokemon): PokemonSnapshot => ({
      name: pokemon.name, speciesForme: pokemon.species.name, hp: pokemon.hp, maxhp: pokemon.maxhp,
      hpPercent: Math.round((pokemon.hp / pokemon.maxhp) * 100), status: pokemon.status, fainted: pokemon.fainted,
      isActive: active[truth.sides[index].id].includes(pokemon.name), boosts: { ...pokemon.boosts },
      moves: pokemon.moveSlots.map(slot => slot.move), ability: pokemon.ability, item: pokemon.item,
      terastallized: '', level: pokemon.level, gender: pokemon.gender,
    })),
  });
  return { turn: truth.turn, p1: side(0), p2: side(1), field: { weather: truth.field.weather, terrain: truth.field.terrain, pseudoWeather: {} }, log };
}

describe.each([
  ['singles', 'gen9customgame', [set('Pikachu', 'Static', ['Taunt', 'Splash'])], [set('Sableye', 'Prankster', ['Tackle', 'Splash']), set('Rillaboom', 'Overgrow', ['Splash']), set('Pidgey', 'Keen Eye', ['Splash'])], '>p1 move 1\n>p2 move 1', 1],
  ['doubles', 'gen9doublescustomgame', [set('Pikachu', 'Static', ['Taunt', 'Splash']), set('Snorlax', 'Immunity', ['Splash'])], [set('Sableye', 'Prankster', ['Tackle', 'Splash']), set('Ogerpon', 'Defiant', ['Tackle', 'Splash']), set('Rillaboom', 'Overgrow', ['Splash']), set('Pidgey', 'Keen Eye', ['Splash'])], '>p1 move 1 1, move 1\n>p2 move 1 1, move 1 1', 2],
] as const)('the body a correction displaces leaves the way the simulator\'s switch leaves it (%s)', (_label, format, p1, p2, turn1) => {
  /** Sableye (p2a) is taunted and stays in the simulator's turn; the game put Rillaboom on p2a. */
  async function scene(): Promise<SimBattle> {
    const { session, battle } = await open(format, [...p1], [...p2]);
    session.writeSim(turn1);
    await toTurn(session, 2);
    expect(ids(battle, 1, 'Sableye')).toContain('taunt');
    return battle;
  }
  const entry = '|switch|p2a: Rillaboom|Rillaboom, M|100/100';

  test('the protocol path clears the displaced body', async () => {
    const battle = await scene();
    correctActivesFromProtocol(battle, [entry]);
    expect(battle.sides[1].active[0]).toBe(bodyOf(battle, 1, 'Rillaboom'));
    expect(ids(battle, 1, 'Sableye')).toEqual([]);
  });

  test('the snapshot path clears the displaced body', async () => {
    const battle = await scene();
    const active = { p1: battle.sides[0].active.map(pokemon => pokemon.name), p2: format.includes('doubles') ? ['Rillaboom', 'Ogerpon'] : ['Rillaboom'] };
    correctBattleFromSnapshot(battle, snapshotFrom(battle, [entry], active));
    expect(battle.sides[1].active[0]).toBe(bodyOf(battle, 1, 'Rillaboom'));
    expect(ids(battle, 1, 'Sableye')).toEqual([]);
  });

  test('a body that keeps its slot keeps its volatiles', async () => {
    const battle = await scene();
    correctActivesFromProtocol(battle, ['|switch|p2a: Sableye|Sableye, M|100/100']);
    expect(ids(battle, 1, 'Sableye')).toContain('taunt');
  });
});

/** Every condition of the Dex and every volatile a move sets: the ids a body can carry in `volatiles` (an id that is none is harmless to the clear). */
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

describe('the sweep: the correction leaves the volatiles the simulator\'s switch leaves', () => {
  test.each(ROWS.map(row => [`${row.rules.name} ${row.mode} slot ${'ab'[row.slot]}`, row] as const))('%s', (_label, { rules, mode, slot }) => {
    const truth = twin(rules, mode);
    const rebuilt = twin(rules, mode);
    const carried = conditionIds(truth);
    expect(carried.length).toBeGreaterThan(20);
    const bench = mode === 'singles' ? 1 : 2;

    const mark = (battle: Battle) => {
      const body = battle.sides[1].active[slot]!;
      for (const id of carried) body.volatiles[id] = battle.initEffectState({ id, target: body });
      body.boosts.atk = 2;
      return body;
    };
    const out = mark(truth);
    const displaced = mark(rebuilt);

    // The simulator's own switch on one board, the correction on its twin.
    const incoming = truth.sides[1].pokemon[bench];
    truth.actions.switchIn(incoming, slot);
    const entering = rebuilt.sides[1].pokemon[bench];
    correctActivesFromProtocol(rebuilt as SimBattle, [`|switch|p2${'ab'[slot]}: ${entering.name}|${entering.species.name}, M|100/100`]);

    expect(rebuilt.sides[1].active[slot]).toBe(entering);
    expect(Object.keys(displaced.volatiles).sort()).toEqual(Object.keys(out.volatiles).sort());
    expect(displaced.boosts).toEqual(out.boosts);
  });
});
