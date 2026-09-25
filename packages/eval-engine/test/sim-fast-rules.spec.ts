import { Dex } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { advancePositionWithLog, createRootPosition, legalChoices } from '../src/forward-model';
import { deserializeFromParsed, parseSearchState, type ParsedSearchState } from '../src/forward/parsed-state';
import { serializeBattleStable } from '../src/forward/serialize';
import { configureSimFast, resetSimFastForTests, takeSimFastReport } from '../src/forward/sim-fast/state';
import { loadPositions, SEEDS, stableLog } from './sim-fast-helpers';

const positions = loadPositions();
const firstOf = (format: string) => positions.find(position => position.format === format)!;

/** The table's content: State.serializeBattle leaves the rule table out (state.mjs:29). */
function tableOf(battle: Battle) {
  const table = battle.ruleTable;
  return { rules: [...table], valueRules: [...table.valueRules], tagRules: [...table.tagRules] };
}

/** One turn per seed with both sides' first legal options: the table in play, not only at rest. */
function playedTurns(serialized: string): string[] {
  const root = createRootPosition(serialized);
  const p1 = legalChoices(root, 'p1')[0].choice;
  const p2 = legalChoices(root, 'p2')[0].choice;
  return SEEDS.map(seed => {
    const { child, log } = advancePositionWithLog(root, p1, p2, seed);
    return `${child.serialized}\n${stableLog(log)}`;
  });
}

function underLever(on: boolean, parsed: ParsedSearchState, serialized: string) {
  configureSimFast(on ? ['rules'] : []);
  const battle = deserializeFromParsed(parsed);
  return { state: serializeBattleStable(battle), table: tableOf(battle), turns: playedTurns(serialized) };
}

// Today's state of gen9ou: the sim never stores its table (the ruleset repeals a
// rule); another spec file of this worker may have left one on the shared format.
beforeEach(() => { Dex.formats.get('gen9ou', true).ruleTable = null; });
afterEach(() => resetSimFastForTests());

describe('lever rules: one rule table per format', () => {
  test('gen9ou builds its table once and every battle shares it', () => {
    const parsed = parseSearchState(firstOf('gen9ou').serialized);
    configureSimFast(['rules']);
    const a = deserializeFromParsed(parsed);
    const b = deserializeFromParsed(parsed);
    expect(a.ruleTable).toBe(b.ruleTable);
    expect(Dex.formats.get('gen9ou', true).ruleTable).toBe(a.ruleTable);
    expect(takeSimFastReport().counters.ruleTables).toBe(2);
  });

  test('gen9doublesou keeps the table the sim stores itself', () => {
    const format = Dex.formats.get('gen9doublesou', true);
    const stored = Dex.forFormat(format).formats.getRuleTable(format);
    configureSimFast(['rules']);
    expect(deserializeFromParsed(parseSearchState(firstOf('gen9doublesou').serialized)).ruleTable).toBe(stored);
  });

  test('the lever off restores today: gen9ou builds a table per battle again', () => {
    const parsed = parseSearchState(firstOf('gen9ou').serialized);
    configureSimFast(['rules']);
    deserializeFromParsed(parsed);
    configureSimFast([]);
    expect(Dex.formats.get('gen9ou', true).ruleTable).toBeNull();
    expect(deserializeFromParsed(parsed).ruleTable).not.toBe(deserializeFromParsed(parsed).ruleTable);
  });

  test('a kept table changes no battle: every fixture gives the same state, the same rule table and the same played turns', () => {
    for (const position of positions) {
      const parsed = parseSearchState(position.serialized);
      const off = underLever(false, parsed, position.serialized);
      const on = underLever(true, parsed, position.serialized);
      expect(on.state, `${position.id} state`).toBe(off.state);
      expect(on.table, `${position.id} rule table`).toEqual(off.table);
      expect(on.turns, `${position.id} played turns`).toEqual(off.turns);
    }
  });
});
