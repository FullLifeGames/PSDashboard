import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import {
  createBranchStateFromBattle, loadSimMods, type BranchMoveOption, type BranchSimState,
} from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../../src/lib/picker-state';

/**
 * Round 70 (T215): the quick picker labels a move with the type it lands with before any Tera click, as the
 * simulator reads it for the body (the move's own rule, then the ability: Weather Ball under the weather that
 * stands, Terrain Pulse under the terrain, the -ate family, Liquid Voice, Normalize). The snapshot knows the
 * field and the guessed set names the ability, so the picker asks the simulator on a one-Pokémon twin instead of
 * keeping the catalog type. The checker is the simulator: the same position as a live battle, read through
 * createBranchStateFromBattle. Every scene runs on a singles and a doubles format.
 */
const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100, gender: '', ...extra,
});

function battleOf(format: string, p1: PokemonSet[], p2: PokemonSet[], turns: number): Battle {
  const battle = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  // Every active plays a move that needs no target (Splash, else Protect) so a doubles turn runs through.
  const quiet = (team: PokemonSet[], slots: number) => team.slice(0, slots)
    .map(entry => `move ${Math.max(1, entry.moves.findIndex(move => move === 'Splash' || move === 'Protect') + 1)}`).join(', ');
  for (let turn = 0; turn < turns; turn++) {
    battle.choose('p1', quiet(p1, battle.sides[0].active.length));
    battle.choose('p2', quiet(p2, battle.sides[1].active.length));
  }
  return battle;
}

/** The viewers' lines of the battle's log, as a replay holds them. */
function publicLog(battle: Battle): string {
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const simState = (battle: Battle): BranchSimState => createBranchStateFromBattle(battle, [], {} as never);

/** The quick picker for the battle's position, as the app builds it from the snapshot and the guessed teams (the battle's own sets). */
function pickerOf(battle: Battle, p1: PokemonSet[], p2: PokemonSet[], gen: number, format: string): BranchSimState {
  const snapshot = parseReplayLogWithObservations(publicLog(battle)).snapshots.at(-1)!;
  return pickerStateFromSnapshot(snapshot, p1, p2, gen, null, { format });
}

type LabelledMove = BranchMoveOption & { typeUnderTera?: string };
const typesOf = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move.type]));
/** The moves of the slot as the buttons would label them with the Tera toggle pressed. */
const clickedTypesOf = (moves: BranchMoveOption[]) => Object.fromEntries((moves as LabelledMove[]).map(move => [move.name, move.typeUnderTera ?? move.type]));

const SHAPES = [
  { label: 'singles', format: 'gen9customgame', doubles: false },
  { label: 'doubles', format: 'gen9doublescustomgame', doubles: true },
] as const;

/** One scene: both teams padded for the shape, the position after `turns` turns of the first moves. */
function scene(format: string, doubles: boolean, p1Lead: PokemonSet, p2Lead: PokemonSet, turns = 1) {
  const p1 = [p1Lead, ...(doubles ? [set('Gliscor', ['Splash'])] : [])];
  const p2 = [p2Lead, ...(doubles ? [set('Corviknight', ['Splash'])] : [])];
  const battle = battleOf(format, p1, p2, turns);
  return { p1, p2, battle, simulated: simState(battle) };
}

describe.each(SHAPES)('T215 the plain label is the simulator\'s type ($label)', ({ format, doubles }) => {
  describe('Weather Ball and Terrain Pulse follow the field the snapshot shows', () => {
    const users = ['Weather Ball', 'Terrain Pulse', 'Splash'];
    test.each([
      ['Politoed', 'Drizzle', 'Water'],
      ['Torkoal', 'Drought', 'Fire'],
      ['Tyranitar', 'Sand Stream', 'Rock'],
      ['Abomasnow', 'Snow Warning', 'Ice'],
    ])('under %s\'s %s: Weather Ball lands as %s', (starter, ability, expected) => {
      const { p1, p2, battle, simulated } = scene(format, doubles, set('Ninetales', users, { ability: 'Flash Fire' }), set(starter, ['Splash'], { ability }));
      const slot = simulated.p1MovesBySlot[0];
      expect(slot.find(move => move.name === 'Weather Ball')!.type, 'the oracle').toBe(expected);
      expect(typesOf(pickerOf(battle, p1, p2, 9, format).p1MovesBySlot[0])).toEqual(typesOf(slot));
    });

    test.each([
      ['Tapu Koko', 'Electric Surge', 'Electric'],
      ['Tapu Bulu', 'Grassy Surge', 'Grass'],
      ['Tapu Lele', 'Psychic Surge', 'Psychic'],
      ['Tapu Fini', 'Misty Surge', 'Fairy'],
    ])('under %s\'s %s: Terrain Pulse lands as %s', (starter, ability, expected) => {
      const { p1, p2, battle, simulated } = scene(format, doubles, set('Ninetales', users, { ability: 'Flash Fire' }), set(starter, ['Splash'], { ability }));
      const slot = simulated.p1MovesBySlot[0];
      expect(slot.find(move => move.name === 'Terrain Pulse')!.type, 'the oracle').toBe(expected);
      expect(typesOf(pickerOf(battle, p1, p2, 9, format).p1MovesBySlot[0])).toEqual(typesOf(slot));
    });

    test('without weather and terrain both stay Normal', () => {
      const { p1, p2, battle, simulated } = scene(format, doubles, set('Ninetales', users, { ability: 'Flash Fire' }), set('Snorlax', ['Splash']));
      expect(simulated.p1MovesBySlot[0].filter(move => move.name !== 'Splash').map(move => move.type)).toEqual(['Normal', 'Normal']);
      expect(typesOf(pickerOf(battle, p1, p2, 9, format).p1MovesBySlot[0])).toEqual(typesOf(simulated.p1MovesBySlot[0]));
    });
  });

  describe('an ability that retypes a move, named by the guessed set', () => {
    test.each([
      ['Sylveon', 'Pixilate', ['Hyper Voice', 'Return', 'Swift'], 'Fairy'],
      ['Salamence', 'Aerilate', ['Hyper Voice', 'Return', 'Earthquake'], 'Flying'],
      ['Aurorus', 'Refrigerate', ['Hyper Voice', 'Return', 'Rock Slide'], 'Ice'],
      ['Raichu-Alola', 'Galvanize', ['Hyper Voice', 'Return', 'Surf'], 'Electric'],
      ['Primarina', 'Liquid Voice', ['Hyper Voice', 'Moonblast', 'Return'], 'Water'],
      ['Delcatty', 'Normalize', ['Water Gun', 'Return', 'Hyper Voice'], 'Normal'],
    ])('%s with %s', (species, ability, moves, retyped) => {
      const { p1, p2, battle, simulated } = scene(format, doubles, set(species, moves, { ability }), set('Snorlax', ['Splash']));
      const oracle = typesOf(simulated.p1MovesBySlot[0]);
      expect(Object.values(oracle), 'the oracle retypes at least one move').toContain(retyped);
      expect(typesOf(pickerOf(battle, p1, p2, 9, format).p1MovesBySlot[0])).toEqual(oracle);
    });
  });

  test('the Tera label is read on the same field: Tera Blast and Weather Ball under rain', () => {
    const lead = set('Garchomp', ['Tera Blast', 'Weather Ball', 'Earthquake'], { teraType: 'Fairy' });
    const { p1, p2, battle, simulated } = scene(format, doubles, lead, set('Politoed', ['Splash'], { ability: 'Drizzle' }));
    const picker = pickerOf(battle, p1, p2, 9, format);
    expect(typesOf(picker.p1MovesBySlot[0])).toEqual(typesOf(simulated.p1MovesBySlot[0]));
    // Weather Ball ignores the click: no label on it. Tera Blast reads the Tera type.
    const clicked = clickedTypesOf(picker.p1MovesBySlot[0]);
    expect(clicked['Weather Ball']).toBe('Water');
    expect(clicked['Tera Blast']).toBe('Fairy');
    expect(clicked['Earthquake']).toBe('Ground');
  });
});

describe('T215 older generations and the Champions mod', () => {
  test.each([4, 6, 7])('gen %s: Weather Ball under rain is the simulator\'s type (singles)', gen => {
    const format = `gen${gen}customgame`;
    const { p1, p2, battle, simulated } = scene(format, false, set('Ninetales', ['Weather Ball', 'Splash']), set('Politoed', ['Splash'], { ability: 'Drizzle' }));
    expect(simulated.p1MovesBySlot[0].find(move => move.name === 'Weather Ball')!.type, 'the oracle').toBe('Water');
    expect(typesOf(pickerOf(battle, p1, p2, gen, format).p1MovesBySlot[0])).toEqual(typesOf(simulated.p1MovesBySlot[0]));
  });

  test.each([
    { gen: 7, format: 'gen7customgame' },
    { gen: 5, format: 'gen5customgame' },
    { gen: 3, format: 'gen3customgame' },
  ])('gen $gen: Hidden Power lands as the type the set\'s IVs give', ({ gen, format }) => {
    // Hidden Power's type is in the IVs: the twin is built with the set's own, as the live battle is.
    const lead = set('Suicune', ['Hidden Power', 'Surf'], { ivs: { hp: 31, atk: 30, def: 30, spa: 31, spd: 31, spe: 30 } });
    const { p1, p2, battle, simulated } = scene(format, false, lead, set('Snorlax', ['Splash']));
    expect(typesOf(simulated.p1MovesBySlot[0])['Hidden Power'], 'the oracle').not.toBe('Normal');
    expect(typesOf(pickerOf(battle, p1, p2, gen, format).p1MovesBySlot[0])).toEqual(typesOf(simulated.p1MovesBySlot[0]));
  });

  test('gen 6: Pixilate retypes Hyper Voice with the old ability list', () => {
    const format = 'gen6customgame';
    const { p1, p2, battle, simulated } = scene(format, false, set('Sylveon', ['Hyper Voice', 'Swift'], { ability: 'Pixilate' }), set('Snorlax', ['Splash']));
    expect(typesOf(simulated.p1MovesBySlot[0])['Hyper Voice'], 'the oracle').toBe('Fairy');
    expect(typesOf(pickerOf(battle, p1, p2, 6, format).p1MovesBySlot[0])).toEqual(typesOf(simulated.p1MovesBySlot[0]));
  });

  test('Champions: Weather Ball under Drought and Hyper Voice with Pixilate, on the mod\'s rules', async () => {
    await loadSimMods('gen9championsou');
    const format = 'gen9championsou';
    const { p1, p2, battle, simulated } = scene(format, false,
      set('Charizard', ['Weather Ball', 'Hyper Voice', 'Protect'], { ability: 'Drought' }), set('Sylveon', ['Hyper Voice', 'Protect'], { ability: 'Pixilate' }));
    const oracle = typesOf(simulated.p1MovesBySlot[0]);
    expect(oracle['Weather Ball'], 'the oracle').toBe('Fire');
    expect(typesOf(pickerOf(battle, p1, p2, 9, format).p1MovesBySlot[0])).toEqual(oracle);
    expect(typesOf(pickerOf(battle, p1, p2, 9, format).p2MovesBySlot[0])).toEqual(typesOf(simulated.p2MovesBySlot[0]));
  }, 60_000);
});

describe('T215 what the picker does not know it leaves at the catalog type', () => {
  test('a body whose set names no ability and whose species may have two that disagree keeps the catalog type', () => {
    const format = 'gen9customgame';
    const { p1, p2, battle } = scene(format, false, set('Sylveon', ['Hyper Voice', 'Swift'], { ability: 'Pixilate' }), set('Snorlax', ['Splash']));
    // The guessed team lacks the ability (a species-only guess) and the log never named it.
    const unnamed = p1.map(entry => ({ ...entry, ability: '' }));
    const picker = pickerOf(battle, unnamed, p2, 9, format);
    expect(typesOf(picker.p1MovesBySlot[0])['Hyper Voice']).toBe('Normal');
  });
});
