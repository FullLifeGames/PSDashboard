import { describe, expect, test, beforeAll } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import {
  parseReplayLogWithObservations,
  buildTeamsFromReplay,
  parseReplayLog,
  type TurnSnapshot,
  type PokemonSnapshot,
} from '@fulllifegames/replay-core';
import {
  createBranchStateFromBattle,
  loadSimMods,
  type BranchMoveOption,
  type BranchSimState,
  type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../../src/lib/picker-state';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const FIXTURES = [
  ['Doubles OU', 'gen9doublesou', 'test/e2e/fixtures/dock-doublesou-2662153814.json'],
  ['Regulation I VGC', 'gen9doublesou', 'test/e2e/fixtures/dock-vgcregi-2573391549.json'],
  ['Champions VGC', 'gen9championsvgc2026regmcbo3', 'test/e2e/fixtures/dock-championsvgc-2625939941.json'],
] as const;

describe('snapshot picker, doubles slots', () => {
  test.each(FIXTURES)('%s: each slot\'s pickers belong to the body standing in it', async (_label, format, path) => {
    const replay = JSON.parse(readFileSync(path, 'utf-8')) as { log: string };
    await loadSimMods(format);
    const snapshots: TurnSnapshot[] = parseReplayLog(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    let reordered = 0;
    const wrong: string[] = [];
    for (let index = 0; index < snapshots.length - 1; index++) {
      const snapshot = snapshots[index];
      const state = pickerStateFromSnapshot(snapshot, p1Team, p2Team, 9, null, { format });
      for (const side of ['p1', 'p2'] as const) {
        const field = snapshot[side].pokemon.filter(mon => mon.isActive && !mon.fainted);
        if (field.some((mon, position) => (mon.slot ?? position) !== position)) reordered += 1;
        const actives = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
        const moves = side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot;
        for (const mon of field) {
          const slot = mon.slot ?? 0;
          if (actives[slot]?.name !== mon.name) wrong.push(`turn ${index} ${side} slot ${slot}: ${actives[slot]?.name} for ${mon.name}`);
          const set = (side === 'p1' ? p1Team : p2Team).find(entry => entry.species === mon.speciesForme || entry.name === mon.name);
          const offered = moves[slot]?.map(option => option.name) ?? [];
          for (const move of set?.moves ?? []) {
            if (!offered.some(name => name.toLowerCase().replace(/[^a-z0-9]/g, '') === move.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
              wrong.push(`turn ${index} ${side} slot ${slot}: ${move} of ${mon.name} is not offered in its slot`);
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    // The check means something only where the party order and the field order differ.
    expect(reordered, 'a snapshot whose team order differs from its field order').toBeGreaterThan(0);
  }, 120_000);

  /**
   * Round 84 (final gate, answer 2a): the scene of T271. In Doubles OU 2663093831 the snapshot picker listed P2's actives in
   * party order while the exact position loaded: P2A and P2B swapped at turns 5 and 12. At turn 15 slot A of both sides fainted
   * with nobody left to come in; the picker keeps two slots a side and leaves slot A empty.
   */
  test('Doubles OU 2663093831: the slots of turns 5, 12 and 15 as the protocol has them', async () => {
    const replay = JSON.parse(readFileSync('test/e2e-feedback/fixtures/gen9doublesou-2663093831.json', 'utf-8')) as { log: string };
    await loadSimMods('gen9doublesou');
    const snapshots: TurnSnapshot[] = parseReplayLog(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const slots = (turn: number) => {
      const snapshot = snapshots.find(entry => entry.turn === turn)!;
      const state = pickerStateFromSnapshot(snapshot, p1Team, p2Team, 9, null, { format: 'gen9doublesou' });
      return { p1: state.p1ActiveSlots.map(mon => mon?.name ?? null), p2: state.p2ActiveSlots.map(mon => mon?.name ?? null) };
    };
    expect(slots(5).p2).toEqual(['the aids missle', 'kanye']);
    expect(slots(12).p2).toEqual(['inflatabully', 'tea pot']);
    expect(slots(15)).toEqual({ p1: [null, 'Chien-Pao'], p2: [null, 'dog'] });
  }, 120_000);
});

describe('picker-state-hp', () => {
  const replay = JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', 'gen9championsou-2693832490.json'), 'utf-8')) as { log: string };
  // Round 75 (T160): every body here is built from a Champions log (on a Scarlet/Violet format as well), and its inference reads the mod.
  beforeAll(async () => { await loadSimMods('gen9championsou'); });
  const FORMATS = [
    { label: 'singles', format: 'gen9ou' },
    { label: 'doubles and VGC', format: 'gen9doublesou' },
    { label: 'Champions singles', format: 'gen9championsou' },
    { label: 'Champions doubles and VGC', format: 'gen9championsvgc2026regmcbo3' },
  ] as const;

  /** The simulator's body for the set, in the replay's display mode (percent). */
  function simulatedBody(format: string, set: PokemonSet) {
    const battle = new Battle({ formatid: format as never, seed: '1,2,3,4', p1: { name: 'A', team: [set] }, p2: { name: 'B', team: [set] } });
    battle.reportExactHP = false;
    const body = battle.sides[0].pokemon[0];
    const shownAt = (hp: number) => {
      body.hp = hp;
      return Number(/^(\d+)\//.exec(body.getHealth().shared)![1]);
    };
    return { maxhp: body.maxhp, shownAt };
  }

  describe('snapshot picker, absolute HP from a percent sighting', () => {
    for (const { label, format } of FORMATS) {
      test(`${label}: every percent from 1 to 100 shows as itself and stands in the middle of its range`, async () => {
        await loadSimMods(format);
        const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
        const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
        const base = snapshot.p1.pokemon.find(mon => !mon.fainted && p1Team.some(set => set.species === mon.speciesForme || set.name === mon.name))!;
        const set = p1Team.find(entry => entry.species === base.speciesForme || entry.name === base.name)!;
        const sim = simulatedBody(format, set);
        const wrong: string[] = [];
        for (let percent = 1; percent <= 100; percent++) {
          const mon: PokemonSnapshot = { ...base, hp: percent, maxhp: 100, hpPercent: percent, isActive: true };
          const lone = { ...snapshot, p1: { ...snapshot.p1, pokemon: [mon] }, p2: { ...snapshot.p2, pokemon: snapshot.p2.pokemon.slice(0, 1) } } as TurnSnapshot;
          const info = pickerStateFromSnapshot(lone, [set], p2Team, 9, null, { format }).p1Pokemon[0];
          expect(info.maxhp, `${format} max HP`).toBe(sim.maxhp);
          const hps = Array.from({ length: sim.maxhp }, (_, index) => index + 1).filter(hp => sim.shownAt(hp) === percent);
          const ok = hps.includes(info.hp) && Math.abs(2 * info.hp - (hps[0] + hps[hps.length - 1])) <= 1;
          if (!ok) wrong.push(`${percent}%: ${info.hp} of ${info.maxhp}, range ${hps[0]}-${hps[hps.length - 1]}`);
        }
        expect(wrong).toEqual([]);
      }, 120_000);
    }

    test('a fainted body stays at 0 HP and a never-revealed body reads full', async () => {
      await loadSimMods('gen9championsou');
      const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
      const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
      const base = snapshot.p1.pokemon.find(mon => p1Team.some(set => set.species === mon.speciesForme || set.name === mon.name))!;
      const set = p1Team.find(entry => entry.species === base.speciesForme || entry.name === base.name)!;
      const read = (mon: PokemonSnapshot) => pickerStateFromSnapshot(
        { ...snapshot, p1: { ...snapshot.p1, pokemon: [mon] }, p2: { ...snapshot.p2, pokemon: snapshot.p2.pokemon.slice(0, 1) } } as TurnSnapshot,
        [set], p2Team, 9, null, { format: 'gen9championsou' },
      ).p1Pokemon[0];
      expect(read({ ...base, fainted: true, hp: 0, maxhp: 100, hpPercent: 0, isActive: false }).hp).toBe(0);
      const unseen = read({ ...base, hp: 0, maxhp: 0, hpPercent: 0, fainted: false, isActive: false });
      expect(unseen.hp).toBe(unseen.maxhp);
    });
  });
});

describe('picker-state-sim-facts', () => {
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
});
