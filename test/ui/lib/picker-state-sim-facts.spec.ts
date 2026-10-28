import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { createBranchStateFromBattle, type BranchMoveOption, type BranchSimState, type SimPokemonInfo } from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../../src/lib/picker-state';

/**
 * Round 69 (T158, spec decision 32): the quick picker, built from a replay snapshot, carries the facts the
 * simulator's body keeps for the calculator: the stat Protosynthesis or Quark Drive raised (boostedStat),
 * Supreme Overlord's fallen allies (alliesFainted), the side's fallen (totalFainted, Last Respects), Hidden
 * Power's type and power (hpType, hpPower), and the type a move lands with after the Tera click (typeUnderTera).
 * The checker is the simulator: the same battle read through createBranchStateFromBattle, and for the Tera label
 * the state after a real click. Every scene runs on a singles and a doubles (VGC) format.
 */
const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100, gender: '', ...extra,
});

type Step = [side: 'p1' | 'p2', choice: string][];

function battleOf(format: string, p1: PokemonSet[], p2: PokemonSet[], steps: Step[]): Battle {
  const battle = new Battle({ formatid: toID(format), seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  for (const step of steps) for (const [side, choice] of step) battle.choose(side, choice);
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

const FACTS = ['boostedStat', 'alliesFainted', 'totalFainted', 'hpType', 'hpPower'] as const;
const factsOf = (info: SimPokemonInfo) => Object.fromEntries(FACTS.map(fact => [fact, info[fact]]));

/** Every body the picker lists has the five facts of the simulator's reading of the same body (a generation without team preview lists only the revealed bodies). */
function expectEqualFacts(picker: BranchSimState, simulated: BranchSimState) {
  let compared = 0;
  for (const side of ['p1Pokemon', 'p2Pokemon'] as const) {
    for (const quick of picker[side]) {
      const body = simulated[side].find(info => info.name === quick.name)!;
      expect(factsOf(quick), `${side} ${quick.name}`).toEqual(factsOf(body));
      compared++;
    }
  }
  expect(compared).toBeGreaterThan(1);
}

const SHAPES = [
  { label: 'singles', format: 'gen9customgame', doubles: false },
  { label: 'doubles', format: 'gen9doublescustomgame', doubles: true },
] as const;

describe.each(SHAPES)('T158 the picker carries the simulator facts ($label)', ({ format, doubles }) => {
  const filler = (species: string) => (doubles ? [set(species, ['Splash'])] : []);
  const together = (choice: string, partner = 'move 1') => (doubles ? `${choice}, ${partner}` : choice);

  test('Protosynthesis and Quark Drive: boostedStat is the stat the volatile names', () => {
    for (const [holder, ability, starter, starterAbility] of [
      ['Roaring Moon', 'Protosynthesis', 'Torkoal', 'Drought'], ['Iron Valiant', 'Quark Drive', 'Pikachu', 'Electric Surge'],
    ] as const) {
      const p1 = [set(holder, ['Splash'], { ability }), ...filler('Gliscor')];
      const p2 = [set(starter, ['Splash'], { ability: starterAbility }), ...filler('Corviknight')];
      const battle = battleOf(format, p1, p2, [[['p1', together('move 1')], ['p2', together('move 1')]]]);
      const simulated = simState(battle);
      expect(simulated.p1Pokemon.find(info => info.name === holder)!.boostedStat, `${ability} did not start`).toBeTruthy();
      expectEqualFacts(pickerOf(battle, p1, p2, 9, format), simulated);
    }
  });

  test('Supreme Overlord and Last Respects: alliesFainted and totalFainted count the side\'s fallen', () => {
    const p1 = doubles
      ? [set('Magikarp', ['Splash'], { level: 5 }), set('Gliscor', ['Splash']), set('Kingambit', ['Splash'], { ability: 'Supreme Overlord' }), set('Houndstone', ['Last Respects'], { ability: 'Fluffy' })]
      : [set('Magikarp', ['Splash'], { level: 5 }), set('Kingambit', ['Splash'], { ability: 'Supreme Overlord' }), set('Houndstone', ['Last Respects'], { ability: 'Fluffy' })];
    const p2 = [set('Mew', ['Psychic', 'Splash']), ...filler('Corviknight')];
    const comeIn = doubles ? 'switch 3' : 'switch 2';
    const battle = battleOf(format, p1, p2, [[['p1', together('move 1')], ['p2', doubles ? 'move 1 1, move 1' : 'move 1']], [['p1', comeIn]]]);
    const simulated = simState(battle);
    const kingambit = simulated.p1Pokemon.find(info => info.name === 'Kingambit')!;
    expect(kingambit.alliesFainted).toBe(1);
    expect(simulated.p1Pokemon.every(info => info.totalFainted === 1)).toBe(true);
    expect(simulated.p2Pokemon.every(info => info.totalFainted === undefined)).toBe(true);
    expectEqualFacts(pickerOf(battle, p1, p2, 9, format), simulated);
  });
});

describe('T158 Hidden Power in the picker', () => {
  const generations = [
    { gen: 7, format: 'gen7customgame' },
    { gen: 6, format: 'gen6customgame' },
    { gen: 5, format: 'gen5customgame' },
    { gen: 3, format: 'gen3customgame' },
  ];
  for (const { gen, format } of generations) {
    test(`gen ${gen}: the typed move and the IVs give the simulator's hpType and hpPower (singles)`, () => {
      const p1 = [
        set('Raikou', ['Hidden Power Fire', 'Thunderbolt']),
        set('Suicune', ['Hidden Power', 'Surf'], { ivs: { hp: 31, atk: 30, def: 30, spa: 31, spd: 31, spe: 30 } }),
        set('Entei', ['Hidden Power', 'Flamethrower'], { ivs: { hp: 30, atk: 29, def: 30, spa: 31, spd: 28, spe: 31 } }),
      ];
      const p2 = [set('Snorlax', ['Splash'])];
      const battle = battleOf(format, p1, p2, []);
      expectEqualFacts(pickerOf(battle, p1, p2, gen, format), simState(battle));
    });
  }

  test('a body without a guessed set reads Hidden Power from the IVs the simulator defaults to', () => {
    const p1 = [set('Raikou', ['Hidden Power Fire', 'Thunderbolt'])];
    const p2 = [set('Snorlax', ['Splash'])];
    const battle = battleOf('gen7customgame', p1, p2, []);
    const picker = pickerOf(battle, p1, [], 7, 'gen7customgame');
    expectEqualFacts(picker, simState(battle));
    expect(picker.p2Pokemon[0].hpType).toBe(simState(battle).p2Pokemon[0].hpType);
  });

  test('gen 9 doubles: a typed Hidden Power on the bench reads like the simulator', () => {
    const p1 = [set('Garchomp', ['Splash']), set('Gliscor', ['Splash']), set('Gengar', ['Hidden Power Ice', 'Splash'])];
    const p2 = [set('Snorlax', ['Splash']), set('Blissey', ['Splash'])];
    const battle = battleOf('gen9doublescustomgame', p1, p2, []);
    expectEqualFacts(pickerOf(battle, p1, p2, 9, 'gen9doublescustomgame'), simState(battle));
  });
});

type LabelledMove = BranchMoveOption & { typeUnderTera?: string };

describe.each(SHAPES)('T158 the picker labels a move with the type after the Tera click ($label)', ({ format, doubles }) => {
  const splash = (species: string) => set(species, ['Splash']);
  const ogerpon = (teraType: string) => set('Ogerpon-Wellspring', ['Splash', 'Ivy Cudgel', 'Tera Blast'], { item: 'Wellspring Mask', teraType });
  const terapagos = () => set('Terapagos', ['Splash', 'Tera Starstorm', 'Tera Blast'], { ability: 'Tera Shift', teraType: 'Stellar' });
  const garchomp = () => set('Garchomp', ['Splash', 'Tera Blast', 'Earthquake'], { teraType: 'Fairy' });

  /** The slot's moves in the picker, each named by what the button would show with the toggle pressed. */
  const labels = (moves: BranchMoveOption[]) => Object.fromEntries((moves as LabelledMove[]).map(move => [move.name, move.typeUnderTera ?? move.type]));
  const afterClick = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move.type]));

  for (const [name, lead] of [['Ogerpon-Wellspring', ogerpon('Water')], ['Terapagos-Terastal', terapagos()], ['Garchomp', garchomp()]] as const) {
    test(`${name}: the label equals the type the state gives after a real click`, () => {
      const p1 = [lead, ...(doubles ? [splash('Gliscor')] : [])];
      const p2 = [splash('Snorlax'), ...(doubles ? [splash('Blissey')] : [])];
      const before = battleOf(format, p1, p2, [[['p1', doubles ? 'move 1, move 1' : 'move 1'], ['p2', doubles ? 'move 1, move 1' : 'move 1']]]);
      const played = battleOf(format, p1, p2, [[['p1', doubles ? 'move 1 terastallize, move 1' : 'move 1 terastallize'], ['p2', doubles ? 'move 1, move 1' : 'move 1']]]);
      const picker = pickerOf(before, p1, p2, 9, format);
      expect(labels(picker.p1MovesBySlot[0])).toEqual(afterClick(simState(played).p1MovesBySlot[0]));
      expect(picker.p1MovesBySlot[0].some(move => (move as LabelledMove).typeUnderTera !== undefined)).toBe(true);
    });
  }

  test('no label for a plain move, and none once the side has terastallized', () => {
    const p1 = [garchomp(), ...(doubles ? [splash('Gliscor')] : [])];
    const p2 = [splash('Snorlax'), ...(doubles ? [splash('Blissey')] : [])];
    const battle = battleOf(format, p1, p2, [[['p1', doubles ? 'move 1 terastallize, move 1' : 'move 1 terastallize'], ['p2', doubles ? 'move 1, move 1' : 'move 1']]]);
    const snapshot = parseReplayLogWithObservations(publicLog(battle)).snapshots.at(-1)!;
    const used = { p1: true, p2: false };
    const picker = pickerStateFromSnapshot(snapshot, p1, p2, 9, null, { format, teraUsed: used });
    expect((picker.p1MovesBySlot[0] as LabelledMove[]).every(move => move.typeUnderTera === undefined)).toBe(true);
    const fresh = pickerOf(battleOf(format, p1, p2, []), p1, p2, 9, format);
    const byName = Object.fromEntries((fresh.p1MovesBySlot[0] as LabelledMove[]).map(move => [move.name, move]));
    expect(byName['Earthquake'].typeUnderTera).toBeUndefined();
    expect(byName['Splash'].typeUnderTera).toBeUndefined();
  });
});
