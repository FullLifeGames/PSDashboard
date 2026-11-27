import { test, expect, describe } from 'vitest';
import { simFormats } from '@fulllifegames/replay-core';
import { parseRevealedTeraSpecies, resolveTeraPreference, teraKey } from '../src/tera';
import { loadSimMods } from '../src/forward/sim-mods';

const draftLog = [
  '|player|p1|Bene|1|',
  '|player|p2|Pres|2|',
  '|tier|[Gen 9] Custom Game',
  '|start',
  '|switch|p1a: Dauni|Uxie, L50|182/182',
  '|switch|p2a: Sig Curtis|Iron Jugulis, L50|100/100',
  '|turn|1',
  '|switch|p2a: 61 Alphonse|Rhydon, L50|100/100',
  '|-terastallize|p2a: 61 Alphonse|Water',
  '|turn|2',
].join('\n');

describe('tera allowance', () => {
  test('revealed tera resolves nicknames to species per side', () => {
    expect(parseRevealedTeraSpecies(draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
  });

  test('auto restricts draft and custom formats to revealed species', () => {
    expect(resolveTeraPreference('auto', 'gen9customgame', draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
    expect(resolveTeraPreference('auto', 'gen9draft', draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
    expect(resolveTeraPreference('auto', 'gen9ou', draftLog)).toBe(true);
    const quiet = draftLog.replace('|-terastallize|p2a: 61 Alphonse|Water\n', '');
    expect(resolveTeraPreference('auto', 'gen9customgame', quiet)).toBe(false);
    expect(resolveTeraPreference('auto', 'gen9ou', quiet)).toBe(false);
  });

  test('explicit modes override the format heuristic', () => {
    expect(resolveTeraPreference('on', 'gen9customgame', draftLog)).toBe(true);
    expect(resolveTeraPreference('off', 'gen9ou', draftLog)).toBe(false);
    expect(resolveTeraPreference('revealed', 'gen9ou', draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
    expect(resolveTeraPreference('revealed', 'gen9ou', draftLog.replace('|-terastallize|p2a: 61 Alphonse|Water\n', ''))).toBe(false);
  });

  test('teraKey encodes allowances stably for cache keys', () => {
    expect(teraKey(true)).toBe('1');
    expect(teraKey(false)).toBe('0');
    expect(teraKey(undefined)).toBe('1');
    const key = teraKey({ p1: ['Bisharp'], p2: ['Rhydon'] });
    expect(key).toBe(teraKey({ p1: ['Bisharp'], p2: ['Rhydon'] }));
    expect(key).not.toBe(teraKey({ p1: [], p2: ['Rhydon'] }));
    expect(key).not.toBe('1');
    // Key-safe characters only (feeds the IndexedDB store key).
    expect(/^[a-z0-9.-]+$/.test(key)).toBe(true);
  });
});

describe('tera auto in a new game', () => {
  const quiet = draftLog.replace('|-terastallize|p2a: 61 Alphonse|Water\n', '');
  const newGame = { newGame: true };

  test.each([
    ['singles', 'gen9ou'],
    ['doubles', 'gen9doublesou'],
    ['vgc', 'gen9vgc2025regi'],
  ])('%s: a ladder format allows Tera before anyone terastallized, and its replay keeps the log rule', (_kind, format) => {
    expect(resolveTeraPreference('auto', format, quiet, newGame)).toBe(true);
    expect(resolveTeraPreference('auto', format, quiet)).toBe(false);
    expect(resolveTeraPreference('revealed', format, quiet, newGame)).toBe(false);
    expect(resolveTeraPreference('off', format, quiet, newGame)).toBe(false);
  });

  test('a new game whose log shows a Tera follows the log as a replay does', () => {
    expect(resolveTeraPreference('auto', 'gen9ou', draftLog, newGame)).toBe(true);
    expect(resolveTeraPreference('auto', 'gen9customgame', draftLog, newGame)).toEqual({ p1: [], p2: ['Rhydon'] });
  });

  test.each(['gen9customgame', 'gen9doublescustomgame', 'gen9draft'])('a new %s game keeps Tera off under Auto', format => {
    expect(resolveTeraPreference('auto', format, quiet, newGame)).toBe(false);
  });

  test('a format whose rule table holds the Terastal Clause, and a generation without Tera, stay off', () => {
    expect(simFormats().getRuleTable(simFormats().get('gen9monotype')).has('terastalclause')).toBe(true);
    for (const format of ['gen9monotype', 'gen9ou@@@Terastal Clause', 'gen9doublesou@@@terastalclause', 'gen8ou', 'gen8vgc2022', 'gen7ou']) {
      expect(resolveTeraPreference('auto', format, quiet, newGame)).toBe(false);
    }
  });

  test.each(['gen9championsou', 'gen9championsvgc2026regmc'])('%s: the mod offers no Tera, so Auto stays off', async format => {
    await loadSimMods(format);
    expect(resolveTeraPreference('auto', format, quiet, newGame)).toBe(false);
  });

  test('every registered format answers as its rule table says: on for a generation 9 format without the clause', () => {
    const wrong: string[] = [];
    for (const format of simFormats().all()) {
      if (format.mod !== 'gen9' || /draft|customgame/.test(format.id)) continue;
      const allowed = !simFormats().getRuleTable(format).has('terastalclause');
      if (resolveTeraPreference('auto', format.id, quiet, newGame) !== allowed) wrong.push(format.id);
    }
    expect(wrong).toEqual([]);
  });
});
