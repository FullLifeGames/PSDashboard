import { test, expect } from '@playwright/test';
import { parseRevealedTeraSpecies, resolveTeraPreference, teraKey } from '../src/tera';

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

test.describe('tera allowance', () => {
  test('revealed tera resolves nicknames to species per side', () => {
    expect(parseRevealedTeraSpecies(draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
  });

  test('auto restricts draft and custom formats to revealed species', () => {
    // Draft leagues grant Tera per Pokémon — only what the replay proved.
    expect(resolveTeraPreference('auto', 'gen9customgame', draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
    expect(resolveTeraPreference('auto', 'gen9draft', draftLog)).toEqual({ p1: [], p2: ['Rhydon'] });
    // Ladder formats: everyone genuinely may Tera once anyone did.
    expect(resolveTeraPreference('auto', 'gen9ou', draftLog)).toBe(true);
    // No tera in the log → off, regardless of format.
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
