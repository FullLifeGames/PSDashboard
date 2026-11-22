import { describe, expect, test } from 'vitest';
import { entryReads, methodsOf } from '../src/dex-facts/state-readers';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEP_CASES } from './dice-sweep-support';
import { boardFor } from './board-key-support';

/**
 * Round 89 (#149, step A8-7): a handler that asks the battle for the turn count (`this.getOverflowedTurnCount()`: the Future Sight
 * and the Wish of every generation that has them) reads the battle's `turn`. The method table holds the `Battle` methods that never
 * reach the event dispatch, so the end of the turn is keyed by the turn where such a handler is on the board; the methods that do
 * reach it (`runEvent`, `damage`, `heal`) stay out, because with their reads (`event`, `effect`, `activeMove`) every board would read the
 * whole battle. The cost probe's third singles search (gen9ou-2658660641#44, turn 47) answered a board whose Future Sight lands from
 * the entry of the turn before; test/residual-memo-state.spec.ts holds the memo to the simulator on it.
 */

await loadSimMods('gen9championscustomgame');

describe.each(SWEEP_CASES)('$name', ({ rules, mode }) => {
  const battle = boardFor(rules, mode, 'tackle');
  const methods = methodsOf(battle);

  test('the turn count of the battle reads the turn, and the event dispatch stays out of the table', () => {
    expect(methods.get('getOverflowedTurnCount')?.has('turn')).toBe(true);
    for (const name of ['runEvent', 'singleEvent', 'eachEvent', 'fieldEvent', 'priorityEvent', 'getCallback']) expect(methods.has(name), name).toBe(false);
  });

  test('the Future Sight and the Wish of the rule set read the turn at the end of the turn', () => {
    const { dex } = battle;
    // The older generations count the turns down in the entry's own state instead; the ones that ask the battle for the turn count read it.
    const asksTheBattle = (entry: object): boolean => JSON.stringify(entry, (_key, value) => (typeof value === 'function' ? String(value) : value)).includes('getOverflowedTurnCount');
    const entries = [dex.conditions.get('futuremove'), dex.moves.get('wish')].filter(entry => entry.exists && asksTheBattle(entry));
    if (rules.generation >= 8 || rules.name.startsWith('Champions')) expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entryReads(entry, 'residual', methods).fields.has('turn'), entry.id).toBe(true);
  });
});
