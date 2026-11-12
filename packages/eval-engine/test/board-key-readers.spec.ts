import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { entryReads, methodsOf } from '../src/dex-facts/state-readers';
import { BOARD_FIELDS } from '../src/score/board-key';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEPS_FULL, type Mode } from './dice-fixtures';
import { SWEEP_CASES, sweepMoves } from './dice-sweep-support';
import { attackerOf, boardFor, defenderOf, HOLDERS, holderOf, twoValues, verdictOf, type Holder, type Lineup } from './board-key-support';

/**
 * Round 89 (#149, step A8): the `read` fields of the board key held to the Dex and to the simulator's own move path. A field
 * of the table's `read` class enters the key only when a handler of an entry on the board names it (dex-facts/state-readers.ts),
 * so this sweep varies each such field on two boards and requires, wherever the hit played without a memo reads differently,
 * that the keys differ too (test/board-key-support.ts, `verdictOf`):
 *
 * - the entries the scan names as readers of the field, each placed where it acts (an ability or an item on the attacker, the
 *   defender and, in doubles, the partners), and a sample of entries it does not name: a field that matters to an entry the scan
 *   missed fails here, and then moves to the `key` class in the table;
 * - a bare board (no ability, no item) with every move that costs its user HP by itself: the move path's own reads
 *   (`moveSlots`, `lastMove`, `hurtThisTurn`, ... of BattleActions) do not reach a hit's cost, or the field moves to `key`.
 *
 * The plain run plays the cases of the four rule sets that count most (Scarlet/Violet and the Champions mod, singles and
 * doubles), the scan's readers up to a few per field and a fixed sample of the others; `DICE_SWEEPS=full` plays every case and every entry.
 */

await loadSimMods('gen9championscustomgame');

const CASES = SWEEPS_FULL ? SWEEP_CASES : SWEEP_CASES.filter(({ name }) => ['Gen 9 singles', 'Gen 9 doubles', 'Champions singles', 'Champions doubles'].includes(name));
/** Entries the scan names for a field: how many the plain run plays, and how many entries it does not name. */
const NAMED_CAP = SWEEPS_FULL ? Infinity : 3;
const SAMPLE = SWEEPS_FULL ? 120 : 4;

type Pair = [unknown, unknown];
type Setter = (battle: Battle, value: unknown) => void;

/** Values for the fields whose current value says no pair. */
const NAMED: Record<string, (battle: Battle) => Pair> = {
  hurtThisTurn: () => [null, 10],
  lastItem: () => ['', 'sitrusberry'],
  lastMove: battle => [null, battle.dex.moves.get('tackle')],
  lastMoveUsed: battle => [null, battle.dex.moves.get('tackle')],
  lastMoveEncore: battle => [null, battle.dex.moves.get('tackle')],
  attackedBy: battle => [[], [{ source: defenderOf(battle), damage: 20, thisTurn: true, move: 'tackle', slot: defenderOf(battle).getSlot() }]],
  moveLastTurnResult: () => [true, false],
  moveThisTurnResult: () => [true, false],
  moveThisTurn: () => ['', 'tackle'],
  faintedLastTurn: battle => [null, battle.sides[0].pokemon[1]],
  faintedThisTurn: battle => [null, battle.sides[0].pokemon[1]],
  lastEnemyMove: battle => [null, battle.dex.moves.get('tackle')],
  lastEnemySelectedMove: () => ['', 'tackle'],
  lastSelectedMove: () => ['', 'tackle'],
  lastSuccessfulMoveThisTurn: () => [null, 'tackle'],
  stellarBoostedTypes: () => [[], ['Fire']],
  volatileStaleness: () => [undefined, 'external'],
  subFainted: () => [null, true],
  apparentType: () => ['Normal', 'Normal/Flying'],
  pendingStaleness: () => [undefined, 'external'],
  staleness: () => [undefined, 'internal'],
};

interface Target { owner: 'pokemon' | 'side' | 'battle'; name: string; who: string; set: Setter; pair: Pair }

/** The `read` fields of the hit consumer with two values each, on the attacker, the defender and, for a side's own fields, both sides. */
function targetsOf(battle: Battle): { targets: Target[]; skipped: string[] } {
  const targets: Target[] = [];
  const skipped: string[] = [];
  const readFields = (owner: 'pokemon' | 'side' | 'battle') => Object.entries(BOARD_FIELDS[owner]).filter(([, [hit]]) => hit === 'read').map(([name]) => name);
  const pairOf = (name: string, current: unknown): Pair | undefined => (NAMED[name] ? NAMED[name](battle) : twoValues(current));
  for (const name of readFields('pokemon')) {
    for (const who of ['attacker', 'defender'] as const) {
      const body = (who === 'attacker' ? attackerOf : defenderOf)(battle) as unknown as Record<string, unknown>;
      const pair = name === 'moveSlots' ? undefined : pairOf(name, body[name]);
      if (name === 'moveSlots') targets.push({ owner: 'pokemon', name, who, pair: [1, 16], set: (live, value) => { (who === 'attacker' ? attackerOf : defenderOf)(live).moveSlots[0].pp = value as number; } });
      else if (pair) targets.push({ owner: 'pokemon', name, who, pair, set: (live, value) => { ((who === 'attacker' ? attackerOf : defenderOf)(live) as unknown as Record<string, unknown>)[name] = value; } });
      else if (who === 'attacker') skipped.push(`pokemon.${name}`);
    }
  }
  for (const name of readFields('side')) {
    const pair = pairOf(name, (battle.sides[0] as unknown as Record<string, unknown>)[name]);
    if (!pair) { skipped.push(`side.${name}`); continue; }
    for (const index of [0, 1] as const) targets.push({ owner: 'side', name, who: `side ${index}`, pair, set: (live, value) => { (live.sides[index] as unknown as Record<string, unknown>)[name] = value; } });
  }
  for (const name of ['turn', 'lastDamage', 'lastMoveLine', 'lastSuccessfulMoveThisTurn', 'midTurn', 'quickClawRoll']) {
    const pair = pairOf(name, (battle as unknown as Record<string, unknown>)[name]) ?? ([0, 3] as Pair);
    targets.push({ owner: 'battle', name, who: 'battle', pair, set: (live, value) => { (live as unknown as Record<string, unknown>)[name] = value; } });
  }
  return { targets, skipped };
}

const holdersOf = (mode: Mode): readonly Holder[] => (mode === 'doubles' ? HOLDERS : ['attacker', 'defender']);

describe.each(CASES)('the read fields of the key hold on $name', ({ rules, mode, name }) => {
  const moves = sweepMoves(rules, move => !!move.recoil || !!move.struggleRecoil, true).moves;
  const move = moves[0]?.id ?? 'tackle';
  const base = boardFor(rules, mode, move);
  const { targets, skipped } = targetsOf(base);
  const { dex } = base;
  const methods = methodsOf(base);
  const valid = (entry: { exists?: boolean; isNonstandard?: string | null }) => entry.exists && (entry.isNonstandard === null || entry.isNonstandard === undefined || entry.isNonstandard === 'Past');
  const abilities = rules.generation >= 3 ? dex.abilities.all().filter(valid).filter(ability => ability.id !== 'noability') : [];
  const items = rules.generation >= 2 ? dex.items.all().filter(valid) : [];
  const entries = [...abilities.map(ability => ({ kind: 'ability' as const, id: ability.id, entry: ability })), ...items.map(item => ({ kind: 'item' as const, id: item.id, entry: item }))];
  const lineupOf = (kind: 'ability' | 'item', id: string, holder: Holder): Lineup => ({ [holder]: { [kind]: id } });

  test('the scan names a reader for the fields that have one, and the rows below have teeth', () => {
    const named = new Set<string>();
    for (const { entry } of entries) for (const field of entryReads(entry, 'hit', methods).fields) named.add(field);
    expect(named.has('activeTurns')).toBe(rules.generation >= 3);
  });

  test('on a bare board, every move that costs its user HP prices each board by its own state', () => {
    const wrong: string[] = [];
    let split = 0;
    for (const recoil of moves) {
      for (const target of targets) {
        const verdict = verdictOf(...(['first', 'second'] as const).map((_, index) => {
          const battle = boardFor(rules, mode, recoil.id);
          target.set(battle, target.pair[index]);
          return battle;
        }) as [Battle, Battle], recoil.id);
        if (verdict === 'wrong') wrong.push(`${name} ${recoil.id} ${target.owner}.${target.name} (${target.who})`);
        if (verdict === 'split') split++;
      }
    }
    expect(wrong).toEqual([]);
    // No read field reaches a bare hit: the sweep's teeth are the control below, a stage (a `key` field) on the same boards.
    expect(split).toBe(0);
    const staged = moves.filter(recoil => recoil.category === 'Physical' && recoil.basePower > 0 && !!recoil.recoil).slice(0, 3).map(recoil => verdictOf(
      ...[0, 1].map(index => { const battle = boardFor(rules, mode, recoil.id); attackerOf(battle).boosts.atk = index * 3; return battle; }) as [Battle, Battle], recoil.id));
    expect(staged).toContain('split');
  });

  test('every ability and item the scan names as a reader, and a sample of the others, on every holder: no board is priced by another', () => {
    const wrong: string[] = [];
    let split = 0;
    let rows = 0;
    const touched = new Set<string>();
    for (const target of targets) {
      const named = entries.filter(({ entry }) => entryReads(entry, 'hit', methods).fields.has(target.name));
      const others = entries.filter(({ entry }) => !entryReads(entry, 'hit', methods).fields.has(target.name));
      const picked = [...named.slice(0, NAMED_CAP), ...others.filter((_, index) => index % Math.max(1, Math.floor(others.length / SAMPLE)) === 0).slice(0, SAMPLE)];
      for (const { kind, id } of picked) {
        for (const holder of holdersOf(mode)) {
          const boards = [0, 1].map(index => {
            const battle = boardFor(rules, mode, move, lineupOf(kind, id, holder));
            target.set(battle, target.pair[index]);
            return battle;
          });
          if (!holderOf(boards[0], holder)) continue;
          rows++;
          const verdict = verdictOf(boards[0], boards[1], move);
          if (verdict === 'wrong') wrong.push(`${name} ${kind}:${id} on ${holder}, ${target.owner}.${target.name} (${target.who})`);
          if (verdict === 'split') { split++; touched.add(target.name); }
        }
      }
    }
    expect(rows).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
    expect(split).toBeGreaterThan(0);
    if (rules.generation >= 3) expect(touched.has('activeTurns')).toBe(true);
    // The fields without a pair of values are named, not dropped; a new simulator field of the `read` class is held by the census.
    expect(skipped.length).toBeLessThan(40);
  });

  test('every move the scan names as a reader, played into a Flame Body, prices each board by its own state', () => {
    if (rules.generation < 3) return;
    const wrong: string[] = [];
    let split = 0;
    let rows = 0;
    for (const target of targets) {
      const readers = dex.moves.all().filter(entry => valid(entry) && entry.category !== 'Status' && entryReads(entry, 'hit', methods).fields.has(target.name));
      for (const reader of readers.slice(0, NAMED_CAP)) {
        const boards = [0, 1].map(index => {
          const battle = boardFor(rules, mode, reader.id, { defender: { ability: 'flamebody' } });
          target.set(battle, target.pair[index]);
          return battle;
        });
        rows++;
        const verdict = verdictOf(boards[0], boards[1], reader.id);
        if (verdict === 'wrong') wrong.push(`${name} ${reader.id}, ${target.owner}.${target.name} (${target.who})`);
        if (verdict === 'split') split++;
      }
    }
    expect(rows).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
    expect(split).toBeGreaterThan(0);
  });
});
