import { Dex } from '@pkmn/sim';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import { serializeBattleStable } from '../src/forward/serialize';
import { configureSimFast, resetSimFastForTests, takeSimFastReport } from '../src/forward/sim-fast/state';
import { loadPositions } from './sim-fast-helpers';

const positions = loadPositions();
const firstOf = (format: string) => positions.find(position => position.format === format)!;

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

  test('a kept table changes no battle: every fixture deserializes to the same string', () => {
    for (const position of positions) {
      const parsed = parseSearchState(position.serialized);
      configureSimFast([]);
      const off = serializeBattleStable(deserializeFromParsed(parsed));
      configureSimFast(['rules']);
      expect(serializeBattleStable(deserializeFromParsed(parsed)), position.id).toBe(off);
    }
  });
});
