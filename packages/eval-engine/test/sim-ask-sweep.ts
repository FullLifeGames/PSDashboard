import { expect } from 'vitest';
import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
import { createRootPosition, legalChoices } from '../src/forward-model';
import { serializeBattleStable } from '../src/forward/serialize';
import type { SimFastLever } from '../src/forward/sim-fast/state';
import { callHandler, fingerprint, isolated, playOnCopy } from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T239): the pieces of the sim-ask checks that the spec runs in the default speed-layer mode and the lane's
 * probe runs in all eight (the long matrix). The sweep calls every handler the stand-ins of the engine reach, in every
 * generation and the Champions mod, on a copy-on-write view and on a real copy of a board.
 */

export const LEVERS: readonly SimFastLever[] = ['rules', 'clone', 'dispatch'];
/** The eight subsets of the speed layer's levers (T103). */
export const MODES: SimFastLever[][] = Array.from({ length: 8 }, (_, bits) => LEVERS.filter((_lever, index) => (bits >> index) & 1));
export const modeName = (mode: readonly SimFastLever[]): string => (mode.length ? mode.join('+') : 'off');

/** One whole turn on the copy: each side's first legal choice. */
export function oneTurn(serialized: string): (copy: Battle) => string {
  const root = createRootPosition(serialized);
  const choices = (['p1', 'p2'] as const).map(side => legalChoices(root, side)[0]?.choice);
  return copy => {
    for (const [index, side] of (['p1', 'p2'] as const).entries()) {
      const choice = choices[index];
      if (choice && choice !== 'wait') copy.choose(side, choice);
    }
    return serializeBattleStable(copy);
  };
}

/** Every gen the corpus plays, and the Champions mod. */
export const RULE_SETS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen} singles`, format: `gen${gen}customgame`, gen, doubles: false })),
  { name: 'Champions singles', format: 'gen9championsou', gen: 9, doubles: false },
  ...[3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen} doubles`, format: `gen${gen}doublescustomgame`, gen, doubles: true })),
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', gen: 9, doubles: true },
];

/** The suite takes the first eight kinds of move in singles and the first four in doubles (a board costs twice as much); the probe takes sixteen. */
export const MOVES_PER_RULES = 16;
export const MOVES_PER_RULES_SUITE = 8;
export const MOVES_PER_RULES_DOUBLES = 4;
/** The sweep that runs in every speed-layer mode takes the first six kinds of move (the suite's single run, the first three). */
export const MODES_MOVES = 6;
export const MODES_MOVES_SHORT = 3;

interface Entry { id: string; exists?: boolean; gen?: number; isNonstandard?: string | null; [key: string]: unknown }

const bodies = (format: string, doubles: boolean): Battle => {
  const team = (species: string) => Array.from({ length: doubles ? 2 : 1 }, () => set(species, ['tackle', 'splash']));
  return battleOf(format, team('Snorlax'), team('Pikachu'));
};
/** [user side, user slot, target side, target slot]: a foe in singles, a foe and the ally in doubles. */
const PAIRS = (doubles: boolean): [number, number, number, number][] => (doubles ? [[0, 0, 1, 0], [0, 0, 0, 1]] : [[0, 0, 1, 0]]);
const stable = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'function' ? 'fn' : inner));
const summary = (body: Pokemon, move: ActiveMove | null): string => stable([body.boosts, body.hp, body.status, Object.keys(body.volatiles).sort(), body.item, body.ability, move && { ...move }]);

function entriesOf(battle: Battle, key: string): { kind: string; entry: Entry }[] {
  const { dex } = battle;
  const gen = dex.gen;
  const live = (entry: Entry) => entry.exists !== false && (entry.gen ?? 0) <= gen;
  const kinds: [string, Entry[]][] = [
    ['ability', dex.abilities.all() as unknown as Entry[]],
    ['item', dex.items.all() as unknown as Entry[]],
    ['move', dex.moves.all() as unknown as Entry[]],
    ['condition', Object.keys((dex.data as unknown as { Conditions: object }).Conditions).map(id => dex.conditions.get(id) as unknown as Entry)],
  ];
  return kinds.flatMap(([kind, entries]) => entries.filter(entry => live(entry) && typeof entry[key] === 'function').map(entry => ({ kind, entry })));
}

/** Calls every handler of the Dex on a view and on a copy of a fresh board; returns the counts, fails on the first difference. */
export function sweepRules({ format, doubles }: (typeof RULE_SETS)[number], movesCap: number): { moves: number; calls: number; refused: string[] } {
  const live = bodies(format, doubles);
  const standard = (live.dex.moves.all() as unknown as (Entry & { flags: Record<string, unknown>; category: string; target: string })[])
    .filter(move => (move.gen ?? 0) <= live.dex.gen && move.exists !== false && !move.isNonstandard);
  // The first move of every category, target and flag the generation has (the first sixteen): each handler meets the kinds of move.
  const kinds = new Map<string, string>();
  for (const move of standard) {
    for (const key of [`category:${move.category}`, `target:${move.target}`, ...Object.keys(move.flags).map(flag => `flag:${flag}`)]) {
      if (!kinds.has(key)) kinds.set(key, move.id);
    }
  }
  const moveIds = [...new Set(kinds.values())].slice(0, movesCap);
  let calls = 0;
  const refused: string[] = [];
  for (const key of ['onTryHit', 'onModifyMove', 'onFractionalPriority', 'onModifyPriority']) {
    for (const { kind, entry } of entriesOf(live, key)) {
      for (const [moveId, [userSide, userSlot, targetSide, targetSlot]] of moveIds.flatMap(id => PAIRS(doubles).map(pair => [id, pair] as const))) {
        const fingerprintExtras = [entry, live.dex.moves.get(moveId)];
        const before = fingerprint(live, fingerprintExtras);
        const view = isolated(live);
        const [mine, theirs] = [view.sides[userSide].active[userSlot] as Pokemon, view.sides[targetSide].active[targetSlot] as Pokemon];
        const viewMove = live.dex.getActiveMove(moveId);
        const handler = entry[key] as (this: Battle, ...args: unknown[]) => unknown;
        const args = (user: Pokemon, target: Pokemon, move: ActiveMove): unknown[] => (
          key === 'onModifyMove' ? [move, user, target]
            : key === 'onTryHit' ? [target, user, move]
              : [0, user, target, move]
        );
        const answered = callHandler(handler as never, view, args(mine, theirs, viewMove));
        expect(fingerprint(live, fingerprintExtras), `${kind} ${entry.id} ${key} ${moveId}`).toBe(before);
        calls++;
        if (!answered.ok) { refused.push(`${entry.id}/${key}`); continue; }
        const copyMove = live.dex.getActiveMove(moveId);
        const onCopy = playOnCopy(live, live.prng.clone(), copy => {
          const [a, b] = [copy.sides[userSide].active[userSlot] as Pokemon, copy.sides[targetSide].active[targetSlot] as Pokemon];
          try {
            const value = handler.call(copy, ...args(a, b, copyMove));
            return { threw: false, value: stable(value), mine: summary(a, copyMove), theirs: summary(b, null) };
          } catch {
            return { threw: true, value: '', mine: '', theirs: '' };
          }
        });
        expect(onCopy.threw, `${kind} ${entry.id} ${key} ${moveId}: the view answered where the copy threw`).toBe(false);
        expect(stable(answered.value), `${kind} ${entry.id} ${key} ${moveId}: value`).toBe(onCopy.value);
        expect(summary(mine, viewMove), `${kind} ${entry.id} ${key} ${moveId}: user`).toBe(onCopy.mine);
        expect(summary(theirs, null), `${kind} ${entry.id} ${key} ${moveId}: target`).toBe(onCopy.theirs);
      }
    }
  }
  expect(calls).toBeGreaterThan(0);
  return { moves: moveIds.length, calls, refused };
}
