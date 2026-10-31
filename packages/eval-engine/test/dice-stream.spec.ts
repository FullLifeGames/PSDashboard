import { describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { LoggedRollPRNG, actionKey, type LoggedRolls } from '../src/branch/logged-rolls';
import { loadSimMods } from '../src/forward/sim-mods';
import { ForcedDicePRNG } from '../src/dice/prng';
import { playForcedTurn } from '../src/dice/play';
import { dieKey, type DieName, type ForcedDie } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { mon, RULES, seedOf, stableLog, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

// Round 82 (forced dice), decisions D5, D7 and D8. A forced die changes the number of draws of the turn (a forced hit after a
// natural miss adds a crit and a roll). The other actions of the turn keep the dice the natural turn drew for them, the first
// action's own new dice fall from the stream, and the stream after the turn stands where the natural turn leaves it.
await loadSimMods('gen9championsou');

/** Pikachu (fast) kicks, Snorlax (slow) tackles; in doubles Blissey tackles Chansey and Chansey tackles Blissey. */
function board(rules: Rules, mode: Mode, seed: string): Battle {
  const pikachu = mon(rules, { species: 'Pikachu', moves: ['megakick', 'splash'] });
  const snorlax = mon(rules, { species: 'Snorlax', moves: ['tackle', 'splash'], gender: 'M' });
  if (mode === 'singles') return battleOf(rules.singles, [pikachu], [snorlax], seed);
  return battleOf(rules.doubles!, [pikachu, mon(rules, { species: 'Blissey', moves: ['tackle', 'splash'] })],
    [snorlax, mon(rules, { species: 'Chansey', moves: ['tackle', 'splash'] })], seed);
}

const FIGHT = { singles: { p1: 'move 1', p2: 'move 1' }, doubles: { p1: 'move 1 1, move 1 2', p2: 'move 1 1, move 1 2' } };
const REST = { singles: { p1: 'move 2', p2: 'move 2' }, doubles: { p1: 'move 2, move 2', p2: 'move 2, move 2' } };

function turn(battle: Battle, clicks: { p1: string; p2: string }): void {
  if (!battle.choose('p1', clicks.p1) || !battle.choose('p2', clicks.p2)) throw new Error(`choice refused ${JSON.stringify(clicks)}`);
}

/** The action blocks of the last turn's log: from a `|move|` line to the next one (the last block ends at the upkeep). */
function segments(battle: Battle): string[] {
  // a game that ended in the turn writes no `|turn|` line after it
  const lines = battle.log.slice(battle.log.lastIndexOf(`|turn|${battle.ended ? battle.turn : battle.turn - 1}`) + 1).filter(line => !line.startsWith('|t:|'));
  const blocks: string[] = [];
  for (const line of lines) {
    if (line.startsWith('|upkeep')) break;
    if (line.startsWith('|move|')) blocks.push(line);
    else if (blocks.length) blocks[blocks.length - 1] += `\n${line}`;
  }
  return blocks;
}

const kick = (kind: DieName['kind']): DieName => ({ slot: 'p1a', moveId: 'megakick', targetSlot: 'p2a', kind });
const accuracy = (happens: boolean): ForcedDie => ({ name: kick('accuracy'), result: { happens } });
const missed = (battle: Battle): boolean => segments(battle)[0].includes('|-miss|');

/** The natural turn on a board, then the board for the forced turn: a plain turn first when `later`. */
function pair(rules: Rules, mode: Mode, seed: string, later: boolean): { natural: Battle; live: Battle } {
  const [natural, live] = [board(rules, mode, seed), board(rules, mode, seed)];
  if (later) for (const battle of [natural, live]) turn(battle, REST[mode]);
  turn(natural, FIGHT[mode]);
  return { natural, live };
}

const cases = RULES.flatMap(rules => (['singles', 'doubles'] as Mode[]).filter(mode => mode === 'singles' || rules.doubles)
  .flatMap(mode => [false, true].map(later => ({ rules, mode, later, label: `${rules.name} ${mode} ${later ? 'a later turn' : 'the first turn'}` }))));

/** The seeds (up to `count`) on which the natural kick misses, or hits. */
function seedsWhere(rules: Rules, mode: Mode, later: boolean, wantMiss: boolean, count: number): string[] {
  const found: string[] = [];
  for (let index = 0; found.length < count && index < 60; index++) {
    const { natural } = pair(rules, mode, seedOf(index), later);
    if (missed(natural) === wantMiss) found.push(seedOf(index));
  }
  return found;
}

describe.each(cases)('the stream of a forced turn: $label', ({ rules, mode, later }: { rules: Rules; mode: Mode; later: boolean }) => {
  test('a forced hit on a natural miss leaves every other action as the natural turn played it and ends on the natural seed', () => {
    const seeds = seedsWhere(rules, mode, later, true, 3);
    expect(seeds.length, 'a seed misses').toBeGreaterThan(0);
    let streamOnlyDiffers = 0;
    for (const seed of seeds) {
      const { natural, live } = pair(rules, mode, seed, later);
      const report = playForcedTurnOn(live, mode, [accuracy(true)]);
      const [forcedBlocks, naturalBlocks] = [segments(live), segments(natural)];
      expect(forcedBlocks.length).toBe(naturalBlocks.length);
      expect(forcedBlocks[0], 'the forced kick lands').not.toContain('|-miss|');
      expect(forcedBlocks[0]).toContain('|-damage|p2a');
      expect(forcedBlocks.slice(1), `${seed}: the other actions`).toEqual(naturalBlocks.slice(1));
      expect(live.prng.getSeed(), `${seed}: the seed after the turn`).toEqual(natural.prng.getSeed());
      expect(report.naturalEndSeed).toBe(String(natural.prng.getSeed()));
      expect(report.forced).toHaveLength(1);
      expect(report.forced[0].took).toBe('applied');
      if (streamOnlyDiffers === 0) streamOnlyDiffers += streamOnly(rules, mode, seed, later, natural) ? 1 : 0;
    }
    // the check bites: without the record and the reset the same forced die moves the other actions or the seed
    expect(streamOnlyDiffers, 'the stream alone would have moved something').toBeGreaterThan(0);
  });

  test('the first action\'s own new dice fall from the stream: its crit and roll are the ones a plain stream gives after the forced draw', () => {
    for (const seed of seedsWhere(rules, mode, later, true, 2)) {
      const { live } = pair(rules, mode, seed, later);
      playForcedTurnOn(live, mode, [accuracy(true)]);
      // reference: a plain PRNG whose first draw of the turn (the kick's accuracy) answers 0, the stream going on as it is
      const reference = board(rules, mode, seed);
      if (later) turn(reference, REST[mode]);
      const inner = reference.prng;
      let first = true;
      reference.prng = new (class extends PRNG {
        override random(from?: number, to?: number): number {
          const value = inner.random(from, to);
          if (!first) return value;
          first = false;
          return 0;
        }
        override getSeed() { return inner.getSeed(); }
      })(seed);
      turn(reference, FIGHT[mode]);
      expect(segments(live)[0], seed).toBe(segments(reference)[0]);
    }
  });

  test('a forced miss on a natural hit and a forced crit end on the natural seed, and the other actions stay', () => {
    for (const seed of seedsWhere(rules, mode, later, false, 2)) {
      for (const forced of [accuracy(false), { name: kick('crit'), result: { happens: true } } as ForcedDie, { name: kick('crit'), result: { happens: false } } as ForcedDie]) {
        const { natural, live } = pair(rules, mode, seed, later);
        playForcedTurnOn(live, mode, [forced]);
        expect(segments(live).slice(1), `${seed} ${dieKey(forced.name)}`).toEqual(segments(natural).slice(1));
        expect(live.prng.getSeed(), `${seed} ${dieKey(forced.name)}`).toEqual(natural.prng.getSeed());
      }
    }
  });

  test('a turn with nothing forced is the plain turn, and a die the simulator never draws is reported as no-draw', () => {
    const seed = seedOf(3);
    const { natural, live } = pair(rules, mode, seed, later);
    const report = playForcedTurnOn(live, mode, []);
    expect(stableLog(live)).toBe(stableLog(natural));
    expect(report.forced).toEqual([]);
    const other = pair(rules, mode, seed, later);
    const never: ForcedDie = { name: { slot: 'p1a', moveId: 'splash', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
    const reported = playForcedTurnOn(other.live, mode, [never]);
    expect(reported.forced[0].took).toBe('no-draw');
    expect(stableLog(other.live)).toBe(stableLog(other.natural));
  });
});

/** Runs the module's turn on the live board: the copy plays the clicks, then the live battle does. */
function playForcedTurnOn(live: Battle, mode: Mode, forced: ForcedDie[]) {
  const seen: Battle[] = [];
  const report = playForcedTurn({ live, forced, play: battle => { seen.push(battle); turn(battle, FIGHT[mode]); } });
  if (forced.length > 0) {
    expect(seen).toHaveLength(2);
    expect(seen[0], 'the first play runs on a copy').not.toBe(live);
    expect(seen[1], 'the second play runs on the live battle').toBe(live);
  }
  return report;
}

/** True when the same forced die, answered from the stream alone (no record, no reset), moves another action or the seed. */
function streamOnly(rules: Rules, mode: Mode, seed: string, later: boolean, natural: Battle): boolean {
  const battle = board(rules, mode, seed);
  if (later) turn(battle, REST[mode]);
  const inner = battle.prng;
  const watch = watchBattle(battle);
  battle.prng = new ForcedDicePRNG({ inner, watch, forced: [accuracy(true)], record: new Map() });
  try {
    turn(battle, FIGHT[mode]);
  } finally {
    watch.uninstall();
    battle.prng = inner;
  }
  return segments(battle).slice(1).join('\n') !== segments(natural).slice(1).join('\n') || inner.getSeed() !== natural.prng.getSeed();
}

describe.each(RULES.map(rules => ({ rules })))('the first turn of a branch over logged dice: $rules.name singles', ({ rules }: { rules: Rules }) => {
  test('the logged dice of the action the user leaves alone survive a forced die, and the seed ends where the natural turn ends', () => {
    // The dice of Snorlax's tackle under seed A, as the log of a played turn would carry them.
    const key = 'p2a:tackle';
    const logged = new Map<string, { from: number | undefined; to: number | undefined; value: number }[]>();
    const loggedBattle = board(rules, 'singles', seedOf(40));
    const recorder = loggedBattle.prng;
    loggedBattle.prng = new (class extends PRNG {
      override random(from?: number, to?: number): number {
        const value = recorder.random(from, to);
        if (actionKey(loggedBattle) === key) logged.set(key, [...(logged.get(key) ?? []), { from, to, value }]);
        return value;
      }
      override getSeed() { return recorder.getSeed(); }
    })(seedOf(40));
    turn(loggedBattle, FIGHT.singles);
    const loggedBlock = segments(loggedBattle)[1];
    expect(logged.get(key)?.length, 'the tackle drew dice').toBeGreaterThan(0);

    const withLog = (seed: string): Battle => {
      const battle = board(rules, 'singles', seed);
      const prng = new LoggedRollPRNG(seed, logged as LoggedRolls, battle.turn);
      prng.attach(battle);
      battle.prng = prng;
      return battle;
    };
    let checked = 0;
    for (let index = 0; index < 60 && checked < 3; index++) {
      const seed = seedOf(index);
      if (seed === seedOf(40)) continue;
      const natural = withLog(seed);
      turn(natural, FIGHT.singles);
      if (!missed(natural)) continue;
      const live = withLog(seed);
      const report = playForcedTurn({ live, forced: [accuracy(true)], play: battle => turn(battle, FIGHT.singles) });
      expect(segments(live)[1], `${seed}: the logged tackle`).toBe(loggedBlock);
      expect(segments(live)[1]).toBe(segments(natural)[1]);
      expect(segments(live)[0]).not.toContain('|-miss|');
      expect(live.prng.getSeed(), `${seed}: the seed`).toEqual(natural.prng.getSeed());
      expect(live.prng).toBeInstanceOf(LoggedRollPRNG);
      expect(report.forced[0].took).toBe('applied');
      checked++;
    }
    expect(checked, 'a seed misses by itself').toBeGreaterThan(0);
  });

  test('a LoggedRollPRNG forks at its place: same seed, same cursors, and the fork never moves the original', () => {
    const logged: LoggedRolls = new Map([['p2a:tackle', [{ from: 100, to: undefined, value: 7 }, { from: 100, to: undefined, value: 9 }]]]);
    const battle = board(rules, 'singles', seedOf(1));
    const prng = new LoggedRollPRNG(seedOf(1), logged, battle.turn);
    const fork = prng.fork();
    expect(fork.getSeed()).toEqual(prng.getSeed());
    fork.random(10);
    expect(prng.getSeed(), 'the original did not move').toEqual(new PRNG(seedOf(1)).getSeed());
    expect(fork.getSeed()).not.toEqual(prng.getSeed());
  });
});
