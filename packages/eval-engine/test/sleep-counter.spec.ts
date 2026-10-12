import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations, type TurnSnapshot } from '@fulllifegames/replay-core';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import type { SimBattle } from '../src/branch/types';

/**
 * Round 69, T187 (spec decision 29): the snapshot carries the sleep turns
 * @pkmn/client counts, and the correction gives a sleeper a remaining count the
 * protocol allows. The range comes from the simulator's own sleep condition
 * (run on a stand-in that records the draw), Rest's exact count from the Rest
 * move, and the Outrage length from the lock condition. Battle B is the game
 * (its log is the protocol); battle A is the simulator's run that drew another
 * length.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[], level = 100): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level,
});

interface Scene {
  format: string;
  /** The second choice fragment: the partner's move in doubles, nothing in singles. */
  partner: string;
  target: string;
  p1: PokemonSet[];
  p2: PokemonSet[];
}

const SINGLES: Pick<Scene, 'format' | 'partner' | 'target'> = { format: 'gen9customgame', partner: '', target: '' };
const DOUBLES: Pick<Scene, 'format' | 'partner' | 'target'> = { format: 'gen9doublescustomgame', partner: ', move 1', target: ' 1' };
const partners = (singles: boolean, sets: [string, string][]) => singles ? [] : sets.map(([species, move]) => set(species, [move]));

const sleepScene = (shape: typeof SINGLES): Scene => ({
  ...shape,
  p1: [set('Parasect', ['Spore', 'Splash', 'Super Fang']), ...partners(shape === SINGLES, [['Gliscor', 'Splash']])],
  p2: [set('Snorlax', ['Splash', 'Rest']), ...partners(shape === SINGLES, [['Corviknight', 'Splash']])],
});
const outrageScene = (shape: typeof SINGLES): Scene => ({
  ...shape,
  p1: [set('Dragonite', ['Outrage', 'Splash'], 30), ...partners(shape === SINGLES, [['Gliscor', 'Splash']])],
  p2: [set('Blissey', ['Splash']), ...partners(shape === SINGLES, [['Corviknight', 'Splash']])],
});

/** A battle played for the given turns (each [p1 choice, p2 choice] without the partner fragment); returns the battle and the public log. */
function play(scene: Scene, seed: number, turns: [string, string][]): { battle: SimBattle; log: string } {
  const battle = new Battle({
    formatid: toID(scene.format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(scene.p1) }, p2: { name: 'Beta', team: Teams.pack(scene.p2) },
  });
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  for (const [p1Choice, p2Choice] of turns) {
    battle.choose('p1', p1Choice + scene.partner);
    battle.choose('p2', p2Choice + scene.partner);
  }
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return { battle: battle as unknown as SimBattle, log };
}

const snapshotAt = (log: string, turn: number): TurnSnapshot =>
  parseReplayLogWithObservations(log).snapshots.find(snapshot => snapshot.turn === turn)!;
const bodyOf = (battle: SimBattle, side: 0 | 1, name: string) => battle.sides[side].pokemon.find(pokemon => pokemon.name === name)!;
const cantsIn = (log: string) => log.split('\n').filter(line => /^\|cant\|p2a: Snorlax\|slp/.test(line)).length;

/** Spore on turn 1, then splashes: the choices of `count` turns. */
const sporeTurns = (scene: Scene, count: number): [string, string][] =>
  [[`move 1${scene.target}`, 'move 1'], ...Array.from({ length: count - 1 }, (): [string, string] => ['move 2', 'move 1'])];

/** The sleep draw as the Dex's own condition makes it: the arguments of the one random call in onStart. */
function sleepDrawOf(dex: Battle['dex']): { lo: number; hi: number } {
  const draws: number[][] = [];
  const standIn = { effectState: {}, add: () => undefined, random: (...args: number[]) => (draws.push(args), args[0]) };
  (dex.conditions.get('slp') as unknown as { onStart: (...args: unknown[]) => void }).onStart.call(standIn, { removeVolatile: () => false }, null, null);
  return { lo: draws[0][0], hi: draws[0][1] };
}

/** A seed whose Spore sleep lasts exactly `cants` cant lines in the scene. */
function seedWithCants(scene: Scene, cants: number): number {
  for (let seed = 1; seed < 400; seed++) {
    if (cantsIn(play(scene, seed, sporeTurns(scene, 6)).log) === cants) return seed;
  }
  throw new Error(`no seed with ${cants} cants`);
}

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('T187 sleep counter (%s)', (_label, shape) => {
  const scene = sleepScene(shape);

  test('the simulator draws a sleep of 1 to 3 cants, the range the Dex condition states', () => {
    const { lo, hi } = sleepDrawOf(new Battle({ formatid: toID(scene.format), p1: { team: Teams.pack(scene.p1) }, p2: { team: Teams.pack(scene.p2) } }).dex);
    const seen = new Set<number>();
    for (let seed = 1; seed <= 600; seed++) seen.add(cantsIn(play(scene, seed, sporeTurns(scene, 6)).log));
    expect([...seen].sort((first, second) => first - second)).toEqual(Array.from({ length: hi - lo }, (_, index) => lo - 1 + index));
  });

  test('a sleeper the sim drew too short gets a count the protocol allows', () => {
    const { hi } = sleepDrawOf(new Battle({ formatid: toID(scene.format), p1: { team: Teams.pack(scene.p1) }, p2: { team: Teams.pack(scene.p2) } }).dex);
    const gameSeed = seedWithCants(scene, 3);
    const simSeed = seedWithCants(scene, 1);
    // Cants fall on turns 2, 3 and 4 of the game: at boundary 3 one is counted, at boundary 5 three.
    for (const boundary of [3, 4, 5]) {
      const turns = sporeTurns(scene, boundary - 1);
      const snapshot = snapshotAt(play(scene, gameSeed, turns).log, boundary);
      const counted = boundary - 2;
      expect(snapshot.p2.pokemon.find(pokemon => pokemon.name === 'Snorlax')!.sleepTurns).toBe(counted);
      const { battle } = play(scene, simSeed, turns);
      correctBattleFromSnapshot(battle, snapshot);
      const sleeper = bodyOf(battle, 1, 'Snorlax');
      expect(sleeper.status).toBe('slp');
      const time = (sleeper.statusState as { time: number }).time;
      expect(time).toBeGreaterThanOrEqual(1);
      expect(time).toBeLessThanOrEqual(hi - 1 - counted);
    }
  });

  test('a count the protocol allows stays and draws nothing', () => {
    const seed = seedWithCants(scene, 3);
    const turns = sporeTurns(scene, 3);
    const snapshot = snapshotAt(play(scene, seed, turns).log, 4);
    const { battle } = play(scene, seed, turns);
    const before = { time: (bodyOf(battle, 1, 'Snorlax').statusState as { time: number }).time, prng: battle.prng.getSeed() };
    expect(before.time).toBeGreaterThan(0);
    correctBattleFromSnapshot(battle, snapshot);
    expect((bodyOf(battle, 1, 'Snorlax').statusState as { time: number }).time).toBe(before.time);
    expect(battle.prng.getSeed()).toEqual(before.prng);
  });

  test('after Rest the count is exactly the Rest count minus the cants', () => {
    const restTurns: [string, string][] = [['move 3' + scene.target, 'move 1'], ['move 2', 'move 2'], ['move 2', 'move 1']];
    const noRest: [string, string][] = [['move 3' + scene.target, 'move 1'], ['move 2', 'move 1'], ['move 2', 'move 1']];
    let rests = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const game = play(scene, seed, restTurns);
      // Super Fang can miss, and Rest fails at full HP.
      if (!game.log.includes('[from] move: Rest')) continue;
      rests++;
      // One block holds the Rest and the first cant: the boundary before it is not corrected.
      const merged = game.log.replace('\n|turn|3\n', '\n');
      const snapshot = snapshotAt(merged, 4);
      const sleeper = snapshot.p2.pokemon.find(pokemon => pokemon.name === 'Snorlax')!;
      expect(sleeper.status).toBe('slp');
      expect(sleeper.sleepTurns).toBe(1);
      expect(snapshot.log.some(line => /^\|-status\|p2a: Snorlax\|slp\|\[from\] move: Rest/.test(line))).toBe(true);
      const { battle } = play(scene, seed, noRest);
      correctBattleFromSnapshot(battle, snapshot);
      expect((bodyOf(battle, 1, 'Snorlax').statusState as { time: number }).time)
        .toBe((bodyOf(game.battle, 1, 'Snorlax').statusState as { time: number }).time);
    }
    expect(rests).toBeGreaterThanOrEqual(5);
  });
});

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('T187 Outrage length (%s)', (_label, shape) => {
  const scene = outrageScene(shape);
  const outrage = (turns: number): [string, string][] => Array.from({ length: turns }, (): [string, string] => ['move 1', 'move 1']);
  const fatigue = (log: string) => log.includes('|-start|p1a: Dragonite|confusion|[fatigue]');
  const volatileIds = (battle: SimBattle) => Object.keys(bodyOf(battle, 0, 'Dragonite').volatiles).sort();

  test('the game ends the lock after two turns while the simulator goes on: the board gets the simulator\'s fatigue', () => {
    let gameSeed = 0;
    let simSeed = 0;
    for (let seed = 1; seed < 200 && !(gameSeed && simSeed); seed++) {
      const log = play(scene, seed, outrage(2)).log;
      if (fatigue(log)) gameSeed ||= seed; else simSeed ||= seed;
    }
    expect(gameSeed && simSeed).toBeTruthy();
    const game = play(scene, gameSeed, outrage(2));
    const snapshot = snapshotAt(game.log, 3);
    expect(snapshot.log.some(line => line.includes('|confusion|[fatigue]'))).toBe(true);
    const { battle } = play(scene, simSeed, outrage(2));
    expect(volatileIds(battle)).toContain('lockedmove');
    expect(volatileIds(battle)).not.toContain('confusion');

    correctBattleFromSnapshot(battle, snapshot);

    expect(volatileIds(battle)).toEqual(volatileIds(game.battle));
  });

  test('a lock the game goes on with is not touched', () => {
    const seed = Array.from({ length: 200 }, (_, index) => index + 1).find(candidate => !fatigue(play(scene, candidate, outrage(2)).log))!;
    const game = play(scene, seed, outrage(2));
    const { battle } = play(scene, seed, outrage(2));
    const before = volatileIds(battle);
    correctBattleFromSnapshot(battle, snapshotAt(game.log, 3));
    expect(volatileIds(battle)).toEqual(before);
    expect(before).toContain('lockedmove');
  });
});
