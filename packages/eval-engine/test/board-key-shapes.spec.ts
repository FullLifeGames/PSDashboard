import { afterEach, describe, expect, test } from 'vitest';
import { bodyStateKey, boardStateKey, readsFactory, BOARD_FIELDS, type Consumer } from '../src/score/board-key';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEP_CASES } from './dice-sweep-support';
import { attackerOf, boardFor, defenderOf } from './board-key-support';

/**
 * Round 89 (#149, step A9): the key of a body or a board is made from the shape of its own fields (which fields it has, in
 * which order) and the read set of its composition. The class of a field and the decision what the key does with it belong to
 * the shape and the consumer, so they are made once per shape for the process, and a read set only picks the fields that a
 * handler on its board reads. Nothing is kept per body: a body that changes between two calls gives the key a fresh build gives.
 */

await loadSimMods('gen9championscustomgame');

const CONSUMERS: Consumer[] = ['hit', 'residual'];

describe('the shape of a body is classified once for the process', () => {
  const counts = { lookups: 0 };
  const originals = { ...BOARD_FIELDS };
  afterEach(() => { Object.assign(BOARD_FIELDS, originals); });

  for (const { rules, mode, name } of SWEEP_CASES) {
    test(`${name}: a second read set of the same composition looks up no field class, and keys the same text`, () => {
      const battle = boardFor(rules, mode, 'tackle');
      const body = attackerOf(battle);
      for (const consumer of CONSUMERS) {
        const base = readsFactory(battle, consumer)([body, defenderOf(battle)], 'tackle');
        const texts = [bodyStateKey(body, base, consumer), bodyStateKey(body, base, consumer, true), boardStateKey(battle, base, consumer)];
        for (const owner of Object.keys(BOARD_FIELDS) as (keyof typeof BOARD_FIELDS)[]) {
          BOARD_FIELDS[owner] = new Proxy(originals[owner], { get(target, name, receiver) { counts.lookups++; return Reflect.get(target, name, receiver); } });
        }
        counts.lookups = 0;
        for (let round = 0; round < 3; round++) {
          const other = new Set(base);
          expect([bodyStateKey(body, other, consumer), bodyStateKey(body, other, consumer, true), boardStateKey(battle, other, consumer)]).toEqual(texts);
        }
        expect(counts.lookups).toBe(0);
      }
    });
  }
});

describe('a body that changes between two calls keys as a fresh build of the changed body does', () => {
  for (const { rules, mode, name } of [SWEEP_CASES[0], SWEEP_CASES[SWEEP_CASES.length - 1]]) {
    test(`${name}: every own field of the attacker that holds a number, a string or a flag, changed in place`, () => {
      const probe = boardFor(rules, mode, 'tackle');
      const fields = Object.entries(attackerOf(probe) as unknown as Record<string, unknown>)
        .filter(([, value]) => ['number', 'string', 'boolean'].includes(typeof value)).map(([field]) => field);
      expect(fields.length).toBeGreaterThan(20);
      const change = (value: unknown): unknown => (typeof value === 'number' ? value + 3 : typeof value === 'boolean' ? !value : `${String(value)}x`);
      for (const consumer of CONSUMERS) {
        const battle = boardFor(rules, mode, 'tackle');
        const reads = readsFactory(battle, consumer)([attackerOf(battle), defenderOf(battle)], 'tackle');
        for (const field of fields) {
          const body = attackerOf(battle) as unknown as Record<string, unknown>;
          const before = bodyStateKey(attackerOf(battle), reads, consumer);
          const kept = body[field];
          body[field] = change(kept);
          const fresh = boardFor(rules, mode, 'tackle');
          (attackerOf(fresh) as unknown as Record<string, unknown>)[field] = change(kept);
          const freshReads = readsFactory(fresh, consumer)([attackerOf(fresh), defenderOf(fresh)], 'tackle');
          expect(bodyStateKey(attackerOf(battle), reads, consumer), `${consumer} ${field}`).toBe(bodyStateKey(attackerOf(fresh), freshReads, consumer));
          body[field] = kept;
          expect(bodyStateKey(attackerOf(battle), reads, consumer), `${consumer} ${field} restored`).toBe(before);
        }
      }
    });
  }
});
