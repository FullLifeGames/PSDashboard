import { beforeAll, describe, expect, test } from 'vitest';
import { formatNote, loadPanelGroups, panelGroups, searchGroups, CALIBRATED_FORMATS } from '../../src/lib/new-game/format-list';
import type { FormatGroup } from '../../src/lib/new-game/format-options';

/**
 * Round 89 (lane H, #105), stage H4: the list of the New game dialog. The simulator's whole list, the five measured families on
 * top under "Calibrated", the Generation 9 Custom Games under "Custom Game", then a group per generation; the search finds a
 * format by its name or its id. Its own file: the Champions mod registers once per process.
 */

describe('the dialog\'s format list', () => {
  let groups: FormatGroup[] = [];
  beforeAll(async () => { groups = await loadPanelGroups(); }, 60_000);

  test('Calibrated first with the five measured families in order, then the Custom Games of Generation 9, then the generations', () => {
    expect(groups[0].label).toBe('Calibrated');
    expect(groups[0].options.map(option => option.id)).toEqual([...CALIBRATED_FORMATS]);
    expect(groups[1].label).toBe('Custom Game');
    expect(groups[1].options.map(option => option.id).sort()).toEqual(['gen9championscustomgame', 'gen9championsdoublescustomgame', 'gen9customgame', 'gen9doublescustomgame']);
    expect(groups.slice(2).map(group => group.label)).toEqual(['Champions', 'Gen 9', 'Gen 8', 'Gen 7', 'Gen 6', 'Gen 5', 'Gen 4', 'Gen 3', 'Gen 2', 'Gen 1']);
  });

  test('the whole list of the simulator: 178 formats, each once; older Custom Games stay in their generation', () => {
    const ids = groups.flatMap(group => group.options.map(option => option.id));
    expect(ids).toHaveLength(178);
    expect(new Set(ids).size).toBe(178);
    expect(groups.find(group => group.label === 'Gen 8')!.options.some(option => option.custom)).toBe(true);
    expect(panelGroups().flatMap(group => group.options)).toHaveLength(178);
  });

  test('the search matches a name or an id in any case and drops the groups it empties', () => {
    expect(searchGroups(groups, '')).toHaveLength(groups.length);
    const vgc = searchGroups(groups, 'vgc');
    expect(vgc.flatMap(group => group.options).length).toBeGreaterThan(5);
    expect(vgc.flatMap(group => group.options).every(option => /vgc/.test(option.id))).toBe(true);
    expect(searchGroups(groups, 'Gen 9 OU').flatMap(group => group.options.map(option => option.id))).toContain('gen9ou');
    expect(searchGroups(groups, 'gen9championsou').flatMap(group => group.options.map(option => option.id))).toEqual(['gen9championsou']);
    expect(searchGroups(groups, 'zzzz')).toEqual([]);
  });

  test('the note names the game type, the bring count at Team Preview and a Custom Game\'s freedom, from the rule table', () => {
    const option = (id: string) => groups.flatMap(group => group.options).find(candidate => candidate.id === id)!;
    expect(formatNote(option('gen9ou'))).toBe('singles');
    expect(formatNote(option('gen9vgc2025regi'))).toBe('doubles · bring 4');
    expect(formatNote(option('gen9championsvgc2026regmc'))).toBe('doubles · bring 4');
    expect(formatNote(option('gen9doublesou'))).toBe('doubles');
    expect(formatNote(option('gen9customgame'))).toBe('singles · any set');
  });
});
