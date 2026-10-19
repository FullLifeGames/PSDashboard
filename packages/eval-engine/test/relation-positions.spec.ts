import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { replayRuleset } from '@fulllifegames/replay-core';
import { readManifest, type ManifestEntry } from './relation-checks';

/**
 * Round 72 (T240): the guard of the relation fixture. The 34 serialized positions already sit under
 * fixtures/positions/ and fixtures/champions/ (bank and holdout games, tracked); the manifest names them, so the
 * relation specs read one list and a lane that edits one of those files breaks this spec, which names the file.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

interface FixtureFile {
  id?: string;
  turn?: number;
  serialized?: string;
}

/** Everything wrong with a manifest entry, one sentence each; an empty list is a sound entry. */
function entryProblems(entry: ManifestEntry): string[] {
  const url = new URL(entry.file, FIXTURES);
  if (!existsSync(url)) return [`${entry.file}: the file does not exist`];
  const file = JSON.parse(readFileSync(url, 'utf-8')) as FixtureFile;
  if (typeof file.serialized !== 'string') return [`${entry.file}: no serialized battle`];
  const problems: string[] = [];
  const battle = JSON.parse(file.serialized) as { gameType?: string; turn?: number };
  if (file.id !== entry.id) problems.push(`${entry.file}: id ${file.id} is not ${entry.id}`);
  if (file.turn !== entry.turn || battle.turn !== entry.turn) problems.push(`${entry.file}: turn is ${file.turn}/${battle.turn}, the manifest says ${entry.turn}`);
  if (battle.gameType !== entry.gameType) problems.push(`${entry.file}: game type is ${battle.gameType}, the manifest says ${entry.gameType}`);
  if (replayRuleset({ id: entry.id }) !== entry.ruleset) problems.push(`${entry.file}: the rule set of ${entry.id} is not ${entry.ruleset}`);
  const group = entry.ruleset === 'standard' ? (entry.gameType === 'doubles' ? 'doublesou' : 'singles') : entry.ruleset;
  if (entry.group !== group) problems.push(`${entry.file}: group ${entry.group}, the rule set and game type say ${group}`);
  if (entry.reason.trim() === '') problems.push(`${entry.file}: no reason`);
  return problems;
}

describe('relation fixture manifest (T240)', () => {
  const entries = readManifest();

  test('lists 30 to 40 positions, none twice', () => {
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(entries.length).toBeLessThanOrEqual(40);
    expect(new Set(entries.map(entry => entry.file)).size).toBe(entries.length);
  });

  test('every entry is a sound position: the file, its id, its turn, its game type, its rule set and its group', () => {
    expect(entries.flatMap(entryProblems)).toEqual([]);
  });

  test('covers singles, doubles OU, VGC and Champions, each in its own group', () => {
    const count = (group: string) => entries.filter(entry => entry.group === group).length;
    expect(count('singles')).toBeGreaterThanOrEqual(10);
    expect(count('doublesou')).toBeGreaterThanOrEqual(8);
    expect(count('vgc')).toBeGreaterThanOrEqual(10);
    expect(count('champions')).toBeGreaterThanOrEqual(3);
    // Both game types in the Champions group: its OU singles board and its two VGC doubles boards.
    expect(new Set(entries.filter(entry => entry.group === 'champions').map(entry => entry.gameType))).toEqual(new Set(['singles', 'doubles']));
  });

  test('holds boards with a fainted body, which the idle stage relation needs', () => {
    const withFainted = entries.filter(entry => /\d+ fainted/.test(entry.reason));
    expect(withFainted.length).toBeGreaterThanOrEqual(20);
  });

  test('the guard can fail: a missing file, a wrong turn, a wrong game type and a wrong rule set are reported', () => {
    const entry = entries.find(candidate => candidate.group === 'vgc')!;
    expect(entryProblems(entry)).toEqual([]);
    expect(entryProblems({ ...entry, file: 'positions/not-there.json' })).toHaveLength(1);
    expect(entryProblems({ ...entry, turn: entry.turn + 1 }).length).toBeGreaterThan(0);
    expect(entryProblems({ ...entry, gameType: 'singles' }).length).toBeGreaterThan(0);
    expect(entryProblems({ ...entry, ruleset: 'standard', group: 'doublesou' }).length).toBeGreaterThan(0);
  });
});
