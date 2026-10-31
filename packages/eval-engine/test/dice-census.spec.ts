import { writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { DIE_KINDS } from '../src/dice/types';
import { CLASSES, DRAW, scan } from './dice-census-support';
import { RULES } from './dice-fixtures';
import { FIRST_MOVERS } from './dice-order-support';
import { CHECKS } from './dice-status-support';
import { dexOfRules } from './dice-sweep-support';


/**
 * Round 82 (forced dice), step A4: the census of the draws that abilities, items and conditions make. The scan reads the
 * simulator's own data tables (the base data, every generation mod the corpus plays, and the Champions bundle), finds every
 * handler (a function under an entry, at any depth) that calls `random`, `randomChance`, `sample` or `shuffle`, and keys each by
 * table, entry and handler. A handler no one has classed fails the census; so does a class whose handler is gone or whose calls
 * changed. The class says whether the dice module owns the draw (a die of an action, of the turn order or of the end of the
 * turn: the user can force it) or leaves it out (a random pick or a duration die, GLOSSARY.md).
 */
await loadSimMods('gen9championsou');

describe('the draws of abilities, items and conditions, scanned (round 82, A4)', () => {
  const found = scan();

  test('the scan', () => {
    if (process.env.DICE_CENSUS_LOG) {
      writeFileSync(process.env.DICE_CENSUS_LOG, [...found].map(([key, calls]) => `${key}: ${[...calls].sort().join(' | ')}`).sort().join('\n') + '\n', 'utf8');
    }
    expect(found.size).toBeGreaterThan(40);
  });

  test('every handler that draws is classed, and every class is a handler the simulator has', () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(CLASSES).sort());
  });

  test('the calls of every handler are the calls its class names', () => {
    for (const [key, calls] of found) expect([...calls].sort(), key).toEqual([...(CLASSES[key]?.calls ?? [])].sort());
  });

  test('a class is in scope or out, by its kind', () => {
    for (const [key, entry] of Object.entries(CLASSES)) {
      const out = entry.kind === 'pick' || entry.kind === 'duration';
      expect(entry.scope === 'out', key).toBe(out);
      if (!out) expect(DIE_KINDS as readonly string[], key).toContain(entry.kind);
      expect(entry.open !== undefined && out, `${key}: an open point is a draw in scope`).toBe(false);
    }
  });

  // The status checks: the handlers of conditions that draw in BeforeMove are exactly the checks the status sweep plays, and the
  // rule set a check first draws in is the Dex's own (a Dex entry whose BeforeMove text calls the PRNG).
  const BEFORE_MOVE = Object.keys(CLASSES).filter(key => key.endsWith('onBeforeMove') && CLASSES[key].kind === 'status-check');

  test('the BeforeMove draws of conditions are the checks of the status sweep', () => {
    const ids = BEFORE_MOVE.map(key => key.split('/')[1]).sort();
    expect(ids).toEqual(CHECKS.map(entry => entry.id).sort());
  });

  test('the first movers the census finds are the ones the order sweep plays', () => {
    const ids = [...new Set(Object.entries(CLASSES).filter(([, entry]) => entry.kind === 'move-first').map(([key]) => key.split('/')[1]))];
    expect(ids.sort()).toEqual(FIRST_MOVERS.map(mover => mover.id).sort());
  });

  describe.each(RULES)('the status checks in $name', rules => {
    test.each(CHECKS.map(entry => [entry.id, entry] as const))('%s draws in BeforeMove exactly from its generation on', (_id, entry) => {
      const dex = dexOfRules(rules);
      // a condition a move carries (infatuation) exists in the rule set when the move does
      const move = dex.moves.get(entry.id);
      const present = !move.exists || move.gen <= dex.gen;
      const handler = (dex.conditions.get(entry.id) as unknown as { onBeforeMove?: () => void }).onBeforeMove;
      const draws = present && typeof handler === 'function' && new RegExp(DRAW.source).test(handler.toString());
      expect(draws, `${entry.id} in ${rules.name}`).toBe(rules.generation >= entry.from);
    });
  });
});
