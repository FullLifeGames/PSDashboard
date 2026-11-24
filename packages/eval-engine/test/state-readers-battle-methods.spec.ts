import { describe, expect, test } from 'vitest';
import { entryReads, methodsOf } from '../src/dex-facts/state-readers';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEP_CASES } from './dice-sweep-support';
import { boardFor } from './board-key-support';


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
    // Older generations count the turns down in the entry's own state; the others read the battle's turn.
    const asksTheBattle = (entry: object): boolean => JSON.stringify(entry, (_key, value) => (typeof value === 'function' ? String(value) : value)).includes('getOverflowedTurnCount');
    const entries = [dex.conditions.get('futuremove'), dex.moves.get('wish')].filter(entry => entry.exists && asksTheBattle(entry));
    if (rules.generation >= 8 || rules.name.startsWith('Champions')) expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entryReads(entry, 'residual', methods).fields.has('turn'), entry.id).toBe(true);
  });
});
