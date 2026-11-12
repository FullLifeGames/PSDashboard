import { describe, expect, test, vi } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { writeFileSync } from 'node:fs';
import { BOARD_FIELDS, bodyStateKey, boardReads } from '../src/score/board-key';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEP_CASES } from './dice-sweep-support';
import { mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';
import { HIT_EVENTS_NEVER, RESIDUAL_EVENTS } from '../src/dex-facts/state-readers';
import { playHit } from '../src/score/contact-play';
import { playResiduals, slotsOf } from '../src/score/residuals';
import { sweepMoves } from './dice-sweep-support';
import { SWEEPS_FULL } from './dice-fixtures';
import { attackerOf, boardFor, defenderOf, type Lineup } from './board-key-support';

/** The events a played copy fires: the copies of the played hit are hooked through the module that makes them. */
const hooks: { onCopy?: (copy: Battle) => void } = {};
vi.mock('../src/sim-ask/copy', async importOriginal => {
  const real = await importOriginal<typeof import('../src/sim-ask/copy')>();
  return { ...real, copyOf: (battle: Battle) => { const copy = real.copyOf(battle); hooks.onCopy?.(copy); return copy; } };
});

const EVENT_CALLS = ['runEvent', 'singleEvent', 'priorityEvent', 'eachEvent', 'fieldEvent'] as const;

/** Records the name of every event the battle fires from now on (the first argument of each call). */
function listen(battle: Battle, fired: Set<string>): void {
  const target = battle as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const call of EVENT_CALLS) {
    const original = target[call];
    target[call] = function (this: unknown, ...args: unknown[]) {
      fired.add(String(args[0]));
      return original.apply(this, args);
    };
  }
}

/**
 * Round 89 (#149, step A8): the census of the board key. The key of the hit memo and of the end-of-turn memo
 * (score/board-key.ts) names every own field of the simulator's `Pokemon`, `Side`, `Field` and `Battle` with a class (keyed,
 * read, normalized, relative, a reference, inert). A simulator that adds a field turns this spec red, so the table grows
 * with the simulator and a new pocket of state never goes unkeyed without a failing row. A field the table does not know
 * is keyed anyway (the fail-safe, checked here too): the key fails toward a lower hit rate, never toward a wrong answer.
 *
 * Every rule set the corpus plays (Gens 1 to 9, the Champions mod), singles and, from Gen 3 on, doubles: a board of
 * three bodies a side after a Substitute, a poison, a hit and a switch.
 */

await loadSimMods('gen9championscustomgame');

/** A board two bodies deep a side (doubles: four) that has played a Substitute, a toxic, a tackle and a switch. */
function playedBoard(rules: Rules, mode: Mode): Battle {
  const doubles = mode === 'doubles';
  const body = (species: string, moves: string[]) => mon(rules, { species, moves, gender: 'M' });
  const p1 = [body('Snorlax', ['substitute', 'toxic', 'tackle', 'splash']), body('Blissey', ['splash']), ...(doubles ? [body('Chansey', ['splash']), body('Pikachu', ['splash'])] : [])];
  const p2 = [body('Vaporeon', ['substitute', 'toxic', 'tackle', 'splash']), body('Chansey', ['splash']), ...(doubles ? [body('Blissey', ['splash']), body('Pikachu', ['splash'])] : [])];
  const battle = battleOf(doubles ? rules.doubles! : rules.singles, p1, p2);
  const click = (move: number) => (doubles ? { p1: `move ${move}${move > 1 ? ' 1' : ''}, move 1`, p2: `move ${move}${move > 1 ? ' 1' : ''}, move 1` } : { p1: `move ${move}`, p2: `move ${move}` });
  for (const move of [1, 2, 3]) playClicks(battle, click(move));
  playClicks(battle, doubles ? { p1: 'switch 3, move 1', p2: 'switch 3, move 1' } : { p1: 'switch 2', p2: 'switch 2' });
  return battle;
}

/** The data fields of an object (a game mod puts methods on the instance: they are the format's, and the format is in the key). */
const dataNames = (object: object): string[] => Object.getOwnPropertyNames(object).filter(name => typeof (object as Record<string, unknown>)[name] !== 'function');

const NAMES = {
  pokemon: (battle: Battle) => dataNames(battle.sides[0].pokemon[0]),
  side: (battle: Battle) => dataNames(battle.sides[0]),
  field: (battle: Battle) => dataNames(battle.field),
  battle: (battle: Battle) => dataNames(battle),
} as const;

/** Fields the simulator creates only when an event happens that the sample board lacks, with the event. */
const AFTER_AN_EVENT: Record<string, string[]> = {
  pokemon: ['terastallized' /* a Terastallization */, 'lastMoveTargetLoc' /* a move with a chosen target slot */],
};

describe('the board key names every own field of the simulator', () => {
  test('every own field of a Pokemon, Side, Field and Battle after two played turns is in the table', () => {
    const missing = { pokemon: new Set<string>(), side: new Set<string>(), field: new Set<string>(), battle: new Set<string>() };
    for (const { rules, mode } of SWEEP_CASES) {
      const battle = playedBoard(rules, mode);
      for (const owner of ['pokemon', 'side', 'field', 'battle'] as const) {
        for (const name of NAMES[owner](battle)) if (!(name in BOARD_FIELDS[owner])) missing[owner].add(name);
      }
    }
    expect(Object.fromEntries(Object.entries(missing).map(([owner, names]) => [owner, [...names].sort().join(' ')]))).toEqual({ pokemon: '', side: '', field: '', battle: '' });
  });

  test('the table names no field the simulator lacks', () => {
    const seen = { pokemon: new Set<string>(), side: new Set<string>(), field: new Set<string>(), battle: new Set<string>() };
    for (const { rules, mode } of SWEEP_CASES) {
      const battle = playedBoard(rules, mode);
      for (const owner of ['pokemon', 'side', 'field', 'battle'] as const) for (const name of NAMES[owner](battle)) seen[owner].add(name);
    }
    const stale = Object.fromEntries((['pokemon', 'side', 'field', 'battle'] as const).map(owner => [owner, Object.keys(BOARD_FIELDS[owner]).filter(name => !seen[owner].has(name) && !(AFTER_AN_EVENT[owner] ?? []).includes(name)).sort().join(' ')]));
    // A field some generation or mod never builds is listed here with its reason; the rest of the table is held to the simulator.
    expect(stale).toEqual({ pokemon: '', side: '', field: '', battle: '' });
  });

  test('a field the table does not know splits the key (the fail-safe), in both consumers', () => {
    const rules = SWEEP_CASES[SWEEP_CASES.length - 1].rules;
    const battle = playedBoard(rules, 'singles');
    const body = battle.sides[0].active[0]! as unknown as Record<string, unknown>;
    for (const consumer of ['hit', 'residual'] as const) {
      const reads = boardReads(battle, consumer);
      const before = bodyStateKey(battle.sides[0].active[0]!, reads, consumer);
      body.aFieldFromTheFuture = 1;
      const after = bodyStateKey(battle.sides[0].active[0]!, reads, consumer);
      delete body.aFieldFromTheFuture;
      expect(after).not.toBe(before);
    }
  });

  test('a played hit fires none of the events the key leaves out, and the end of the turn only the events it reads', () => {
    const fired = new Set<string>();
    hooks.onCopy = copy => listen(copy, fired);
    const cases = SWEEPS_FULL ? SWEEP_CASES : SWEEP_CASES.filter(({ name }) => ['Gen 9 singles', 'Gen 9 doubles', 'Champions singles', 'Champions doubles', 'Gen 4 singles', 'Gen 1 singles'].includes(name));
    const residualFired = new Set<string>();
    for (const { rules, mode } of cases) {
      const moves = sweepMoves(rules, move => move.category !== 'Status', true).moves;
      const probe = boardFor(rules, mode, 'tackle');
      const abilities = rules.generation >= 3 ? probe.dex.abilities.all().filter(ability => ability.exists && !ability.isNonstandard).map(ability => ability.id) : [];
      const items = rules.generation >= 2 ? probe.dex.items.all().filter(item => item.exists && !item.isNonstandard).map(item => item.id) : [];
      const lineups: Lineup[] = [{}, { defender: { ability: 'flamebody' } }, { defender: { ability: 'static' } }, { defender: { ability: 'poisonpoint', item: 'stickybarb' } }, { attacker: { item: 'lifeorb' }, defender: { item: 'rockyhelmet', ability: 'roughskin' } }];
      for (const ability of abilities.filter((_, index) => SWEEPS_FULL || index % 12 === 0)) lineups.push({ attacker: { ability } }, { defender: { ability } });
      for (const item of items.filter((_, index) => SWEEPS_FULL || index % 12 === 0)) lineups.push({ attacker: { item } }, { defender: { item } });
      for (const move of moves) {
        for (const lineup of lineups.filter((_, index) => SWEEPS_FULL || index < 5 || index % 7 === 0)) {
          const battle = boardFor(rules, mode, move.id, lineup);
          playHit(battle, attackerOf(battle), defenderOf(battle), move.id);
        }
      }
      // The end of the turn: a board with a status, a Substitute and a weather has played.
      const battle = boardFor(rules, mode, 'tackle');
      const copy = (battle.sides[0].active[0] as unknown as { battle: Battle }).battle;
      listen(copy, residualFired);
      playResiduals(copy, slotsOf(copy));
    }
    hooks.onCopy = undefined;
    writeFileSync(process.env.BOARD_KEY_EVENTS ?? '/dev/null', JSON.stringify({ hit: [...fired].sort(), residual: [...residualFired].sort() }, null, 1));
    expect([...fired].filter(event => HIT_EVENTS_NEVER.has(event))).toEqual([]);
    expect([...residualFired].filter(event => !RESIDUAL_EVENTS.has(event))).toEqual([]);
  });
});
