import { afterEach, describe, expect, test, vi } from 'vitest';
import type { OpponentTeamInfo } from '@fulllifegames/replay-core';
import {
  TEAM_EDITS_VERSION, forgetImportText, loadTeamEdits, readImportText, saveTeamEdits, teamEditsKey,
} from '../../../src/lib/team-edits-store';

const mon = (species: string, item = 'Leftovers') => ({
  species, ability: { value: 'Pressure', source: 'guessed' as const }, item: { value: item, source: 'manual' as const },
  moves: [{ value: 'Protect', source: 'manual' as const }],
}) as unknown as OpponentTeamInfo['pokemon'][number];
const team = (...species: string[]): OpponentTeamInfo => ({ pokemon: species.map(name => mon(name)) });

const inferred = { p1: team('Garchomp', 'Gholdengo'), p2: team('Dragapult', 'Heatran', 'Kingambit') };

afterEach(() => { vi.restoreAllMocks(); });

describe('team edits store (an edit made in the editor survives a reload)', () => {
  test('a saved edit reads back whole, one record per replay, with a version', () => {
    const edit = { p1: null, p2: team('Dragapult', 'Heatran', 'Kingambit') };
    saveTeamEdits('game-1', edit);
    expect(JSON.parse(localStorage.getItem(teamEditsKey('game-1'))!)).toMatchObject({ version: TEAM_EDITS_VERSION, p1: null });
    expect(loadTeamEdits('game-1', inferred)).toEqual(edit);
    expect(loadTeamEdits('game-2', inferred)).toBeNull();
  });

  test('both sides can be stored; a side that was never edited stays null', () => {
    const edit = { p1: team('Garchomp', 'Gholdengo'), p2: null };
    saveTeamEdits('game-1', edit);
    expect(loadTeamEdits('game-1', inferred)).toEqual(edit);
  });

  test.each([
    ['another version', JSON.stringify({ version: TEAM_EDITS_VERSION + 1, p1: null, p2: team('Dragapult', 'Heatran', 'Kingambit') })],
    ['no version', JSON.stringify({ p1: null, p2: team('Dragapult', 'Heatran', 'Kingambit') })],
    ['text that is no JSON', '{"version":'],
    ['a side that is no team', JSON.stringify({ version: TEAM_EDITS_VERSION, p1: { pokemon: 'x' }, p2: null })],
    ['a species the replay does not have', JSON.stringify({ version: TEAM_EDITS_VERSION, p1: null, p2: team('Dragapult', 'Heatran', 'Garchomp') })],
    ['fewer bodies than the replay showed', JSON.stringify({ version: TEAM_EDITS_VERSION, p1: null, p2: team('Dragapult', 'Heatran') })],
  ])('a record with %s is ignored and stays in storage', (_name, raw) => {
    localStorage.setItem(teamEditsKey('game-1'), raw);
    expect(loadTeamEdits('game-1', inferred)).toBeNull();
    expect(localStorage.getItem(teamEditsKey('game-1'))).toBe(raw);
  });

  test('a side with extra bodies (stand-ins of a game without team preview) is kept', () => {
    const edit = { p1: team('Garchomp', 'Gholdengo', 'Corviknight'), p2: null };
    saveTeamEdits('game-1', edit);
    expect(loadTeamEdits('game-1', inferred)).toEqual(edit);
  });

  test('a storage that throws or is full never throws out of the store', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(() => saveTeamEdits('game-1', { p1: null, p2: team('Dragapult', 'Heatran', 'Kingambit') })).not.toThrow();
    expect(loadTeamEdits('game-1', inferred)).toBeNull();
    expect(readImportText('game-1')).toBeNull();
    expect(() => forgetImportText('game-1')).not.toThrow();
  });

  test('the import text of a replay reads and goes through the same key an import writes', () => {
    localStorage.setItem('ps-replay-interceptor:sets:game-1', 'text');
    expect(readImportText('game-1')).toBe('text');
    forgetImportText('game-1');
    expect(readImportText('game-1')).toBeNull();
    expect(localStorage.getItem('ps-replay-interceptor:sets:game-1')).toBeNull();
  });
});
