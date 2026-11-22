import { describe, expect, test } from 'vitest';
import { formatGroups, loadFormatGroups, playableFormats } from '../../src/lib/new-game/format-options';

/**
 * Round 89 (lane H, #105), stage H2: the formats the new-game panel lists. Its own file: the Champions mod registers once per
 * process, and the first test reads the registry before it does.
 */

describe('the format list', () => {
  const FEATURED = ['gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9championsou', 'gen9championsvgc2026regmc', 'gen9customgame'];

  test('before the Champions mod loads the list has no Champions format; after it, all of them', async () => {
    expect(playableFormats().some(option => option.champions)).toBe(false);
    const groups = await loadFormatGroups(FEATURED);
    const ids = groups.flatMap(group => group.options.map(option => option.id));
    for (const id of FEATURED) expect(ids).toContain(id);
    expect(groups.find(group => group.label === 'Champions')?.options.every(option => option.champions && option.generation === 9)).toBe(true);
  }, 60_000);

  test('the featured families come first in the order given, every playable format appears once, nothing else does', async () => {
    await loadFormatGroups();
    const groups = formatGroups(FEATURED);
    expect(groups[0].label).toBe('Featured');
    expect(groups[0].options.map(option => option.id)).toEqual(FEATURED);
    const ids = groups.flatMap(group => group.options.map(option => option.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(178);
    expect(ids).not.toContain('gen9randombattle');
    expect(ids).not.toContain('gen6triplescustomgame');
    expect(ids).not.toContain('gen9championsrandombattle');
    expect(ids.filter(id => /random/.test(id))).toEqual([]);
  });

  test('a group per generation, newest first, the Champions group before them; a Custom Game leads its group', async () => {
    await loadFormatGroups();
    const labels = formatGroups().map(group => group.label);
    expect(labels).toEqual(['Champions', 'Gen 9', 'Gen 8', 'Gen 7', 'Gen 6', 'Gen 5', 'Gen 4', 'Gen 3', 'Gen 2', 'Gen 1']);
    const gen9 = formatGroups().find(group => group.label === 'Gen 9')!;
    expect(gen9.options[0].custom).toBe(true);
    expect(gen9.options.every(option => option.generation === 9 && !option.champions)).toBe(true);
    expect(formatGroups().find(group => group.label === 'Gen 1')!.options.every(option => option.generation === 1)).toBe(true);
  });
});
