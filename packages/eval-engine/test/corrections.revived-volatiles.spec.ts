import { describe, expect, test } from 'vitest';
import type { PokemonSnapshot } from '@fulllifegames/replay-core';
import { parseReplayLogWithObservations, type TurnSnapshot } from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { serializeBattleStable, deserializeBattleExact } from '../src/forward-model';
import { buildForcedSwitchChoice, correctActivesFromProtocol, correctBattleFromSnapshot } from '../src/branch/corrections';
import { openSession, startBattle, waitForBattle, type ReconstructionSession } from '../src/branch/runtime-session';
import type { SimBattle } from '../src/branch/types';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';

/**
 * When the simulator faints a body the game kept, the boundary correction revives it, and the volatiles the simulator wiped at the
 * faint (Protosynthesis or Quark Drive with its best stat, Leech Seed) come back, unless the protocol ended them. Battle B is the
 * game's truth (the body survives the same hit); battle A is the simulator's run (the body stands at 1 HP and is knocked out).
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Hardy', evs, ivs, level: 100,
});

interface Scene {
  format: string;
  p1: PokemonSet[];
  p2: PokemonSet[];
  victim: string;
  turn1: string;
  turn2: string;
}

const SINGLES: Scene = {
  format: 'gen9customgame',
  p1: [set('Great Tusk', 'Protosynthesis', ['Splash']), set('Gliscor', 'Hyper Cutter', ['Splash'])],
  p2: [set('Torkoal', 'Drought', ['Leech Seed', 'Earthquake'])],
  victim: 'Great Tusk',
  turn1: '>p1 move 1\n>p2 move 1',
  turn2: '>p1 move 1\n>p2 move 2',
};

const DOUBLES: Scene = {
  format: 'gen9doublescustomgame',
  p1: [set('Iron Treads', 'Quark Drive', ['Splash']), set('Gliscor', 'Hyper Cutter', ['Splash']), set('Rillaboom', 'Overgrow', ['Splash'])],
  p2: [set('Tapu Koko', 'Electric Surge', ['Leech Seed', 'Earthquake']), set('Corviknight', 'Pressure', ['Splash']), set('Amoonguss', 'Regenerator', ['Splash'])],
  victim: 'Iron Treads',
  turn1: '>p1 move 1, move 1\n>p2 move 1 1, move 1',
  turn2: '>p1 move 1, move 1\n>p2 move 2, move 1',
};

async function openScene(scene: Scene): Promise<ReconstructionSession> {
  const session = openSession({
    format: scene.format, p1Team: scene.p1, p2Team: scene.p2, replayLog: '', targetTurn: 9,
  }, Date.now() + 60_000);
  await startBattle(session, scene.p1, scene.p2);
  return session;
}

const bodyOf = (battle: SimBattle, name: string) => battle.sides[0].pokemon.find(pokemon => pokemon.name === name)!;

/** Plays turn 1, then turn 2; with `knockOut` the victim stands at 1 HP when the hit lands. Returns the battle after any forced switch. */
async function play(scene: Scene, knockOut: boolean, bare = false): Promise<SimBattle> {
  const session = await openScene(scene);
  const battle = session.battleStream.battle!;
  // `bare` writes straight to the stream, past the session's faint subscription.
  if (bare) session.writeSim = payload => void session.streams.omniscient.write(payload);
  session.writeSim(scene.turn1);
  await waitForBattle(session, current => current.turn >= 2);
  if (knockOut) bodyOf(battle, scene.victim).hp = 1;
  session.writeSim(scene.turn2);
  await waitForBattle(session, current => current.turn >= 3 || current.sides[0].activeRequest?.forceSwitch !== undefined);
  const forced = buildForcedSwitchChoice(battle, 0, [], { current: 0 });
  if (forced) {
    session.writeSim(`>p1 ${forced}`);
    await waitForBattle(session, current => current.turn >= 3);
  }
  return battle;
}

function snapshotFrom(truth: SimBattle, log: string[] = []): TurnSnapshot {
  const side = (index: number) => ({
    name: truth.sides[index].name,
    id: truth.sides[index].id as 'p1' | 'p2',
    sideConditions: {},
    pokemon: truth.sides[index].pokemon.map((pokemon): PokemonSnapshot => ({
      name: pokemon.name,
      speciesForme: pokemon.species.name,
      hp: pokemon.hp,
      maxhp: pokemon.maxhp,
      hpPercent: Math.round((pokemon.hp / pokemon.maxhp) * 100),
      status: pokemon.status,
      fainted: pokemon.fainted,
      isActive: truth.sides[index].active.includes(pokemon),
      boosts: { ...pokemon.boosts },
      moves: pokemon.moveSlots.map(slot => slot.move),
      ability: pokemon.ability,
      item: pokemon.item,
      terastallized: '',
      level: pokemon.level,
      gender: pokemon.gender,
    })),
  });
  return {
    turn: truth.turn,
    p1: side(0),
    p2: side(1),
    field: { weather: truth.field.weather, terrain: truth.field.terrain, pseudoWeather: {} },
    log,
  };
}

const ids = (battle: SimBattle, name: string) => Object.keys(bodyOf(battle, name).volatiles).sort();
const durationOf = (battle: SimBattle, name: string, id: string) =>
  (bodyOf(battle, name).volatiles[id] as { duration?: number } | undefined)?.duration;
const bestStatOf = (battle: SimBattle, name: string) => {
  const volatiles = bodyOf(battle, name).volatiles as Record<string, { bestStat?: string }>;
  return Object.values(volatiles).map(state => state.bestStat).filter(Boolean);
};

describe.each([
  ['singles', SINGLES], ['doubles', DOUBLES],
  // gen9draft is a custom format: its Format object is no Format for the sim's onEvent.
  ['singles, gen9draft', { ...SINGLES, format: 'gen9draft' }],
] as const)('revived volatiles (%s)', (_label, scene) => {
  test('a body the simulator fainted and the game kept gets its volatiles back', async () => {
    const truth = await play(scene, false);
    const simulated = await play(scene, true);
    expect(bodyOf(simulated, scene.victim).fainted).toBe(true);
    expect(ids(truth, scene.victim)).toContain('leechseed');
    expect(bestStatOf(truth, scene.victim).length).toBe(1);
    expect(ids(simulated, scene.victim)).toEqual([]);

    correctBattleFromSnapshot(simulated, snapshotFrom(truth));

    expect(bodyOf(simulated, scene.victim).fainted).toBe(false);
    expect(ids(simulated, scene.victim)).toEqual(ids(truth, scene.victim));
    expect(bestStatOf(simulated, scene.victim)).toEqual(bestStatOf(truth, scene.victim));
  });

  test('the record survives the calibration clone (serialized raw boundary, then corrected)', async () => {
    const truth = await play(scene, false);
    const simulated = await play(scene, true);
    const clone = deserializeBattleExact(serializeBattleStable(simulated));

    correctBattleFromSnapshot(clone, snapshotFrom(truth));

    expect(ids(clone, scene.victim)).toEqual(ids(truth, scene.victim));
    expect(bestStatOf(clone, scene.victim)).toEqual(bestStatOf(truth, scene.victim));
  });

  test('a volatile the protocol ended is not restored', async () => {
    const truth = await play(scene, false);
    const simulated = await play(scene, true);
    const ended = `|-end|p1${scene.victim === 'Iron Treads' ? 'a' : 'a'}: ${scene.victim}|Leech Seed|[from] move: Rapid Spin`;

    correctBattleFromSnapshot(simulated, snapshotFrom(truth, [ended]));

    expect(ids(simulated, scene.victim)).not.toContain('leechseed');
    expect(ids(simulated, scene.victim)).toEqual(ids(truth, scene.victim).filter(id => id !== 'leechseed'));
  });

  test('a body that really fainted gets nothing', async () => {
    const simulated = await play(scene, true);
    const snapshot = snapshotFrom(simulated);

    correctBattleFromSnapshot(simulated, snapshot);

    expect(bodyOf(simulated, scene.victim).fainted).toBe(true);
    expect(ids(simulated, scene.victim)).toEqual([]);
  });

  test('the subscription changes nothing the simulator plays', async () => {
    const watched = await play(scene, true);
    const bare = await play(scene, true, true);

    expect(bodyOf(bare, scene.victim).fainted).toBe(true);
    expect(watched.log.filter(line => !line.startsWith('|t:|'))).toEqual(bare.log.filter(line => !line.startsWith('|t:|')));
    expect(watched.prng.getSeed()).toEqual(bare.prng.getSeed());
  });

  test('the exit record leaves the battle serializable and clean after the correction', async () => {
    const truth = await play(scene, false);
    const simulated = await play(scene, true);
    expect(() => serializeBattleStable(simulated)).not.toThrow();
    expect((simulated as unknown as { events: unknown }).events ?? null).toBeNull();

    correctBattleFromSnapshot(simulated, snapshotFrom(truth));

    expect(serializeBattleStable(simulated)).not.toContain('volatilesAtExit');
  });
});

/**
 * A body the simulator pulled in and the game never had consumed its Booster Energy at the entry (no Sun); the game's body still holds
 * the item. A body the protocol did show keeps the game's verdict: it came in without a trigger line, so the item is ruled out.
 */
describe.each([
  ['singles', 'gen9ou', 1],
  ['doubles', 'gen9doublesou', 2],
] as const)('items the simulator alone consumed (%s)', (_label, format, actives) => {
  const doubles = actives === 2;
  const teams = {
    p1Team: [
      set('Magikarp', 'Swift Swim', ['Splash']),
      ...(doubles ? [set('Pidgey', 'Keen Eye', ['Splash'])] : []),
      { ...set('Great Tusk', 'Protosynthesis', ['Splash']), item: 'Booster Energy' },
    ],
    p2Team: [set('Garchomp', 'Rough Skin', ['Earthquake']), ...(doubles ? [set('Corviknight', 'Pressure', ['Splash'])] : [])]
      .map(entry => (entry.species === 'Garchomp' ? { ...entry, evs: { ...evs, atk: 252 } } : entry)),
  };
  const header = [
    `|gametype|${doubles ? 'doubles' : 'singles'}`, '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9',
    `|tier|[Gen 9] ${doubles ? 'Doubles OU' : 'OU'}`, '|start',
    `|switch|p1a: Magikarp|Magikarp, M|100/100`,
    ...(doubles ? ['|switch|p1b: Pidgey|Pidgey, M|100/100'] : []),
    '|switch|p2a: Garchomp|Garchomp, M|100/100',
    ...(doubles ? ['|switch|p2b: Corviknight|Corviknight, M|100/100'] : []),
    '|turn|1',
  ];
  const moves = [
    '|move|p2a: Garchomp|Earthquake|p1a: Magikarp',
    ...(doubles ? ['|move|p2b: Corviknight|Splash|p2b: Corviknight', '|-nothing', '|move|p1b: Pidgey|Splash|p1b: Pidgey', '|-nothing'] : []),
  ];
  /** The game's Magikarp lives on 10 %; the simulator's Garchomp knocks it out and brings Great Tusk in. */
  const survives = [...header, ...moves, '|-damage|p1a: Magikarp|10/100', '|move|p1a: Magikarp|Splash|p1a: Magikarp', '|-nothing', '|upkeep', '|turn|2'].join('\n');
  const faints = [
    ...header, ...moves, '|-damage|p1a: Magikarp|0 fnt', '|faint|p1a: Magikarp', '|', '|switch|p1a: Great Tusk|Great Tusk|100/100', '|upkeep', '|turn|2',
  ].join('\n');

  const run = async (replayLog: string) => {
    const { observations } = parseReplayLogWithObservations(replayLog);
    const runtime = await reconstructBranchRuntime({
      format, ...teams, replayLog, targetTurn: 2, choiceLocks: buildChoiceLockContext(replayLog, teams, observations),
    });
    return runtime.battleStream.battle!;
  };
  const tusk = (battle: SimBattle) => battle.sides[0].pokemon.find(pokemon => pokemon.name === 'Great Tusk')!;

  test('an item only the simulator consumed comes back: the body never entered in the protocol', async () => {
    const battle = await run(survives);
    expect(battle.log.some(line => line.startsWith('|-enditem|p1a: Great Tusk|Booster Energy'))).toBe(true);
    expect(tusk(battle).item).toBe('boosterenergy');
  });

  test('a body the protocol shows keeps the verdict of the game: it came in without a trigger line', async () => {
    const battle = await run(faints);
    expect(battle.log.some(line => line.startsWith('|-enditem|p1a: Great Tusk|Booster Energy'))).toBe(true);
    expect(tusk(battle).item).toBe('');
  });
});

/**
 * A switch-out the game never saw clears the volatiles too: 752755 turn 9, where the build's guessed Eject Button sent Hatterene out of the
 * simulator after a Psychic Noise that had started Heal Block, and the game kept it in.
 */
describe.each([
  ['singles', 'gen9customgame', [set('Hatterene', 'Healer', ['Splash']), set('Gliscor', 'Hyper Cutter', ['Splash'])],
    [set('Hatterene', 'Healer', ['Psychic Noise'])], '>p1 move 1\n>p2 move 1'],
  ['doubles', 'gen9doublescustomgame', [set('Hatterene', 'Healer', ['Splash']), set('Pidgey', 'Keen Eye', ['Splash']), set('Gliscor', 'Hyper Cutter', ['Splash'])],
    [set('Hatterene', 'Healer', ['Psychic Noise']), set('Corviknight', 'Pressure', ['Splash'])], '>p1 move 1, move 1\n>p2 move 1 1, move 1'],
] as const)('a body the simulator switched out and the game kept (%s)', (_label, format, p1, p2, turn) => {
  const playOut = async (ejects: boolean): Promise<SimBattle> => {
    const team = p1.map((entry, index) => (index === 0 && ejects ? { ...entry, item: 'Eject Button' } : entry));
    const session = await openSession({ format, p1Team: team, p2Team: [...p2], replayLog: '', targetTurn: 9 }, Date.now() + 60_000);
    await startBattle(session, team, [...p2]);
    const battle = session.battleStream.battle!;
    session.writeSim(turn);
    await waitForBattle(session, current => current.turn >= 2 || current.sides[0].activeRequest?.forceSwitch !== undefined);
    const forced = buildForcedSwitchChoice(battle, 0, [], { current: 0 });
    if (forced) {
      session.writeSim(`>p1 ${forced}`);
      await waitForBattle(session, current => current.turn >= 2);
    }
    return battle;
  };

  test('the displaced body comes back on the field with its volatiles', async () => {
    const truth = await playOut(false);
    const simulated = await playOut(true);
    expect(ids(truth, 'Hatterene')).toEqual(['healblock']);
    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(false);
    expect(ids(simulated, 'Hatterene')).toEqual([]);

    correctBattleFromSnapshot(simulated, snapshotFrom(truth));

    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(true);
    expect(ids(simulated, 'Hatterene')).toEqual(['healblock']);
    // The game's counter ticked at the turn's residual round; the simulator's body stood on the bench for it.
    expect(durationOf(simulated, 'Hatterene', 'healblock')).toBe(durationOf(truth, 'Hatterene', 'healblock'));
  });

  test('the protocol puts the displaced body back with one entry line in the block', async () => {
    const simulated = await playOut(true);
    const entry = '|switch|p1a: Hatterene|Hatterene, F|100/100';
    expect(ids(simulated, 'Hatterene')).toEqual([]);

    correctActivesFromProtocol(simulated, [entry, '|move|p2a: Hatterene|Psychic Noise|p1a: Hatterene', '|-start|p1a: Hatterene|move: Heal Block']);

    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(true);
    expect(ids(simulated, 'Hatterene')).toEqual(['healblock']);
  });

  test('two entry lines make two stints: the record of the first does not carry over', async () => {
    const simulated = await playOut(true);
    const entry = '|switch|p1a: Hatterene|Hatterene, F|100/100';

    correctActivesFromProtocol(simulated, [entry, '|switch|p1a: Hatterene|Hatterene, F|100/100']);

    expect(ids(simulated, 'Hatterene')).toEqual([]);
  });

  test('a body both worlds took off the field keeps nothing from the record', async () => {
    const simulated = await playOut(true);
    const snapshot = snapshotFrom(simulated);

    correctBattleFromSnapshot(simulated, snapshot);

    expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(false);
    expect(ids(simulated, 'Hatterene')).toEqual([]);
  });
});

describe('doubles-revival-slot', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const set = (species: string, moves: string[]): PokemonSet => ({
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100,
  });

  const GLISCOR = set('Gliscor', ['Earthquake', 'Splash']);
  const PARASECT = set('Parasect', ['Spore', 'Splash']);
  const RILLABOOM = set('Rillaboom', ['Grassy Glide', 'Splash']);
  const FOES = [set('Snorlax', ['Splash']), set('Corviknight', ['Splash']), set('Amoonguss', ['Splash'])];

  function start(format: string, p1: PokemonSet[], p2: PokemonSet[]): { battle: SimBattle; log: string } {
    const battle = new Battle({
      formatid: toID(format), seed: [1, 2, 3, 4],
      p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
    });
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
    const lines = battle.log;
    const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
    return { battle: battle as unknown as SimBattle, log };
  }

  const snapshotOf = (log: string): TurnSnapshot => parseReplayLogWithObservations(log).snapshots.find(snapshot => snapshot.turn === 1)!;
  const activeNames = (battle: SimBattle) => battle.sides[0].active.map(pokemon => pokemon.name);
  const moveNames = (battle: SimBattle, slot: number) =>
    (battle.sides[0].activeRequest as { active: { moves: { move: string }[] }[] }).active[slot].moves.map(move => move.move);

  describe('doubles revival slot', () => {
    const game = start('gen9doublescustomgame', [GLISCOR, PARASECT, RILLABOOM], FOES);
    const board = () => start('gen9doublescustomgame', [PARASECT, GLISCOR, RILLABOOM], FOES).battle;

    test('the snapshot slot puts an active on its slot, with side.pokemon and the request in step', () => {
      const snapshot = snapshotOf(game.log);
      expect(snapshot.p1.pokemon.filter(pokemon => pokemon.isActive).map(pokemon => [pokemon.name, pokemon.slot])).toEqual([['Gliscor', 0], ['Parasect', 1]]);
      const battle = board();
      expect(activeNames(battle)).toEqual(['Parasect', 'Gliscor']);

      correctBattleFromSnapshot(battle, snapshot);

      expect(activeNames(battle)).toEqual(activeNames(game.battle));
      const side = battle.sides[0];
      expect(side.active.map((pokemon, index) => side.pokemon[index] === pokemon)).toEqual([true, true]);
      expect(side.active.map(pokemon => pokemon.position)).toEqual([0, 1]);
      expect(moveNames(battle, 0)).toEqual(moveNames(game.battle, 0));
      expect(moveNames(battle, 1)).toEqual(moveNames(game.battle, 1));
    });

    test('a body that trades slots keeps its last move: it never left the field', () => {
      const battle = board();
      const parasect = battle.sides[0].active[0];
      const spore = battle.dex.getActiveMove('spore');
      parasect.lastMove = spore;
      correctBattleFromSnapshot(battle, snapshotOf(game.log));
      expect(battle.sides[0].active[1]).toBe(parasect);
      expect(parasect.lastMove).toBe(spore);
    });

    test('a snapshot without slots leaves the board as it was', () => {
      const snapshot = snapshotOf(game.log);
      for (const side of [snapshot.p1, snapshot.p2]) for (const pokemon of side.pokemon) delete pokemon.slot;
      const battle = board();
      correctBattleFromSnapshot(battle, snapshot);
      expect(activeNames(battle)).toEqual(['Parasect', 'Gliscor']);
    });

    test('a board that already stands as the game does is not touched', () => {
      const battle = start('gen9doublescustomgame', [GLISCOR, PARASECT, RILLABOOM], FOES).battle;
      const before = serializeBattleStable(battle);
      correctBattleFromSnapshot(battle, snapshotOf(game.log));
      expect(serializeBattleStable(battle)).toBe(before);
    });
  });

  describe('singles', () => {
    test('slot 0 on a board that has the body there changes nothing', () => {
      const { battle, log } = start('gen9customgame', [GLISCOR, PARASECT], FOES.slice(0, 1));
      const snapshot = snapshotOf(log);
      expect(snapshot.p1.pokemon.find(pokemon => pokemon.isActive)!.slot).toBe(0);
      const before = serializeBattleStable(battle);
      correctBattleFromSnapshot(battle, snapshot);
      expect(serializeBattleStable(battle)).toBe(before);
    });
  });
});

describe('revived-volatiles-switch', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const set = (species: string, ability: string, moves: string[], item = ''): PokemonSet => ({
    name: species, species, item, ability, moves, nature: 'Hardy', evs, ivs, level: 100,
  });

  interface Scene {
    format: string;
    p1: PokemonSet[];
    p2: PokemonSet[];
    turn1: string;
    turn2: string;
    other: string;
    events: string[];
  }

  const SINGLES: Scene = {
    format: 'gen9customgame',
    p1: [set('Hatterene', 'Healer', ['Splash'], 'Choice Specs'), set('Rillaboom', 'Overgrow', ['Splash']), set('Gliscor', 'Hyper Cutter', ['Splash'])],
    p2: [set('Torkoal', 'Drought', ['Leech Seed', 'Earthquake'])],
    turn1: '>p1 move 1\n>p2 move 1',
    turn2: '>p1 switch 2\n>p2 move 2',
    other: 'Gliscor',
    events: [
      '|switch|p1a: Rillaboom|Rillaboom, M|100/100', '|move|p2a: Torkoal|Earthquake|p1a: Rillaboom',
      '|faint|p1a: Rillaboom', '|switch|p1a: Hatterene|Hatterene, F|100/100',
    ],
  };

  const DOUBLES: Scene = {
    format: 'gen9doublescustomgame',
    p1: [set('Hatterene', 'Healer', ['Splash'], 'Choice Specs'), set('Gliscor', 'Hyper Cutter', ['Splash']), set('Rillaboom', 'Overgrow', ['Splash']), set('Pidgey', 'Keen Eye', ['Splash'])],
    p2: [set('Tapu Koko', 'Electric Surge', ['Leech Seed', 'Earthquake']), set('Corviknight', 'Pressure', ['Splash']), set('Amoonguss', 'Regenerator', ['Splash'])],
    turn1: '>p1 move 1, move 1\n>p2 move 1 1, move 1',
    turn2: '>p1 switch 3, move 1\n>p2 move 2, move 1',
    other: 'Pidgey',
    events: [
      '|switch|p1a: Rillaboom|Rillaboom, M|100/100', '|move|p2a: Tapu Koko|Earthquake|p1a: Rillaboom',
      '|faint|p1a: Rillaboom', '|switch|p1a: Hatterene|Hatterene, F|100/100',
    ],
  };

  const bodyOf = (battle: SimBattle, name: string) => battle.sides[0].pokemon.find(pokemon => pokemon.name === name)!;
  const ids = (battle: SimBattle, name: string) => Object.keys(bodyOf(battle, name).volatiles).sort();

  /** Turn 1 (the Choice lock and Leech Seed land on Hatterene), turn 2 (it switches out and the replacement is knocked out), then the replacement the game or the simulator sent. */
  async function play(scene: Scene, replacement: string): Promise<SimBattle> {
    const session = openSession({ format: scene.format, p1Team: scene.p1, p2Team: scene.p2, replayLog: '', targetTurn: 9 }, Date.now() + 60_000);
    await startBattle(session, scene.p1, scene.p2);
    const battle = session.battleStream.battle!;
    session.writeSim(scene.turn1);
    await waitForBattle(session, current => current.turn >= 2);
    bodyOf(battle, 'Rillaboom').hp = 1;
    session.writeSim(scene.turn2);
    await waitForBattle(session, current => current.turn >= 3 || current.sides[0].activeRequest?.forceSwitch !== undefined);
    const forced = buildForcedSwitchChoice(battle, 0, [replacement], { current: 0 });
    session.writeSim(`>p1 ${forced}`);
    await waitForBattle(session, current => current.turn >= 3);
    return battle;
  }

  function snapshotFrom(truth: SimBattle, log: string[]): TurnSnapshot {
    const side = (index: number) => ({
      name: truth.sides[index].name,
      id: truth.sides[index].id as 'p1' | 'p2',
      sideConditions: {},
      pokemon: truth.sides[index].pokemon.map((pokemon): PokemonSnapshot => ({
        name: pokemon.name, speciesForme: pokemon.species.name, hp: pokemon.hp, maxhp: pokemon.maxhp,
        hpPercent: Math.round((pokemon.hp / pokemon.maxhp) * 100), status: pokemon.status, fainted: pokemon.fainted,
        isActive: truth.sides[index].active.includes(pokemon), boosts: { ...pokemon.boosts },
        moves: pokemon.moveSlots.map(slot => slot.move), ability: pokemon.ability, item: pokemon.item,
        terastallized: '', level: pokemon.level, gender: pokemon.gender,
      })),
    });
    return { turn: truth.turn, p1: side(0), p2: side(1), field: { weather: truth.field.weather, terrain: truth.field.terrain, pseudoWeather: {} }, log };
  }

  describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('a body both worlds switched out and the game brought back (%s)', (_label, scene) => {
    test('the simulator carried a Choice lock and Leech Seed out, and the game entered fresh', async () => {
      const truth = await play(scene, 'Hatterene');
      expect(ids(truth, 'Hatterene')).toEqual([]);
      expect(bodyOf(truth, 'Hatterene').moveSlots.some(slot => slot.disabled)).toBe(false);
      const simulated = await play(scene, scene.other);
      expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(false);
    });

    test('the protocol path puts it back without the volatiles of its first stint', async () => {
      const truth = await play(scene, 'Hatterene');
      const simulated = await play(scene, scene.other);

      correctActivesFromProtocol(simulated, scene.events);

      expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(true);
      expect(ids(simulated, 'Hatterene')).toEqual(ids(truth, 'Hatterene'));
    });

    test('the snapshot path puts it back without the volatiles of its first stint', async () => {
      const truth = await play(scene, 'Hatterene');
      const simulated = await play(scene, scene.other);

      correctBattleFromSnapshot(simulated, snapshotFrom(truth, scene.events));

      expect(simulated.sides[0].active.includes(bodyOf(simulated, 'Hatterene'))).toBe(true);
      expect(ids(simulated, 'Hatterene')).toEqual(ids(truth, 'Hatterene'));
    });

    test('the Choice lock does not narrow the moves the corrected body offers', async () => {
      const truth = await play(scene, 'Hatterene');
      const simulated = await play(scene, scene.other);

      correctBattleFromSnapshot(simulated, snapshotFrom(truth, scene.events));

      const slots = (battle: SimBattle) => bodyOf(battle, 'Hatterene').moveSlots.map(slot => `${slot.id}${slot.disabled ? '!' : ''}`);
      expect(slots(simulated)).toEqual(slots(truth));
    });
  });
});
