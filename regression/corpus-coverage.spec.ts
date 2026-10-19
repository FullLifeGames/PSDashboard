import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';
import { bankIds, bankLogs, coverageOf, fixtureLogs } from '../scripts/corpus-coverage.mjs';

/**
 * Round 72 (T237): scripts/corpus-coverage.mjs counts the replays that carry each rule-bearing population (generation, game type,
 * protocol features, move classes read from the Dex by property) for the bank, the fit corpus and the fixtures. A population with
 * no replays is one where a rule error is invisible to every measurement. The cases run the counter on small written logs (one
 * singles, one doubles, one VGC, one Z-move, one CRLF) and on a real fixture, and the CLI once on the fixtures column.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/corpus-coverage.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => (JSON.parse(readFileSync(path.join(REPO, file), 'utf8')) as { log: string }).log;

const SINGLES = ['|gametype|singles', '|gen|9', '|tier|[Gen 9] OU', '|switch|p1a: Nick|Garchomp, L50, M, shiny|100/100', '|switch|p2a: Heatran|Heatran, M|100/100',
  '|move|p1a: Nick|Protect|p1a: Nick', '|move|p2a: Heatran|Metronome|p2a: Heatran', '|move|p1a: Nick|U-turn|p2a: Heatran', '|-terastallize|p1a: Nick|Ground'].join('\n');
const DOUBLES = ['|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU', '|switch|p1a: Incineroar|Incineroar, M|100/100', '|switch|p2a: Rillaboom|Rillaboom, F|100/100',
  '|move|p1a: Incineroar|Fake Out|p2a: Rillaboom', '|move|p2a: Rillaboom|Wide Guard|p2a: Rillaboom'].join('\n');
const VGC = ['|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2026 Reg I', '|teampreview|4', '|move|p1a: A|Tackle|p2a: B'].join('\n');
const Z_MOVE = ['|gametype|singles', '|gen|7', '|tier|[Gen 7] OU', '|move|p1a: A|Devastating Drake|p2a: B|[zeffect]'].join('\n');

describe('coverageOf', () => {
  test('counts generations, game types and protocol features, once per replay', () => {
    const { total, groups } = coverageOf([SINGLES, DOUBLES, VGC, Z_MOVE]);
    expect(total).toBe(4);
    expect(groups.generation['Gen 9']).toBe(3);
    expect(groups.generation['Gen 7']).toBe(1);
    expect(groups['game type']).toMatchObject({ singles: 2, doubles: 1, VGC: 1, Champions: 0 });
    expect(groups['protocol feature']).toMatchObject({
      'Z-move (zeffect)': 1, Terastallization: 1, 'a shiny body': 1, 'a level other than 100': 1, 'a nickname that differs from the species': 1, 'CRLF line endings': 0,
    });
  });

  test('a CRLF log counts the same as its LF text and also carries the CRLF mark', () => {
    const lf = coverageOf([SINGLES]);
    const crlf = coverageOf([SINGLES.replace(/\n/g, '\r\n')]);
    expect(crlf.groups['protocol feature']['CRLF line endings']).toBe(1);
    for (const group of ['generation', 'game type', 'move class'] as const) expect(crlf.groups[group]).toEqual(lf.groups[group]);
    expect({ ...crlf.groups['protocol feature'], 'CRLF line endings': 0 }).toEqual(lf.groups['protocol feature']);
  });

  test('move classes come from Dex properties through the move lines, singles and doubles', () => {
    const { groups } = coverageOf([SINGLES, DOUBLES]);
    const classes = groups['move class'];
    // Protect (singles) is a stalling move; Wide Guard (doubles) sets a side condition; Metronome calls a move; U-turn switches out.
    expect(classes['stalling move (Protect family)']).toBe(1);
    expect(classes['sets a side condition (screens, hazards, ...)']).toBe(1);
    expect(classes['calls another move']).toBe(1);
    expect(classes['switches the user out']).toBe(1);
    expect(classes['has a priority other than 0']).toBe(2);
    expect(classes['is a Z-move']).toBe(0);
    // The expectations rest on the Dex properties the script reads.
    expect(Dex.moves.get('metronome').callsMove).toBeTruthy();
    expect(Dex.moves.get('wideguard').sideCondition).toBeTruthy();
    expect(Dex.moves.get('protect').stallingMove).toBeTruthy();
  });

  test('every label is present with 0 when no replay carries it', () => {
    const { total, groups } = coverageOf([]);
    expect(total).toBe(0);
    expect(Object.values(groups.generation).every(count => count === 0)).toBe(true);
    expect(Object.keys(groups['move class']).length).toBeGreaterThanOrEqual(15);
  });

  test('the real Gen 7 fixture carries one Z-move replay and reads as Gen 7 singles', () => {
    const log = read('packages/replay-core/test/fixtures/smogtours-gen7ou-450650.json');
    const { total, groups } = coverageOf([log]);
    expect(total).toBe(1);
    expect(groups['protocol feature']['Z-move (zeffect)']).toBe(1);
    expect(groups.generation['Gen 7']).toBe(1);
    expect(groups['game type'].singles).toBe(1);
    expect(groups['move class']['is a Z-move']).toBe(1);
  });
});

describe('columns and CLI', () => {
  test('fixtureLogs reads each distinct log once', () => {
    const logs = fixtureLogs();
    expect(logs.length).toBeGreaterThan(10);
    expect(new Set(logs).size).toBe(logs.length);
  });

  test('bankIds reads the unique ids of a run folder and bankLogs reports an offline fetch', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'corpus-coverage-'));
    try {
      writeFileSync(path.join(dir, 'merged.jsonl'), [{ id: 'gen9nope-1' }, { id: 'gen9nope-1' }, { id: 'gen9nope-2' }].map(row => JSON.stringify(row)).join('\n') + '\n{"id":');
      expect(bankIds(dir)).toEqual(['gen9nope-1', 'gen9nope-2']);
      const offline = await bankLogs(dir, dir, { fetcher: () => Promise.reject(new Error('offline')) });
      expect(offline).toEqual({ ids: 2, missing: 2, logs: [] });
      mkdirSync(path.join(dir, '.fit-corpus'));
      writeFileSync(path.join(dir, '.fit-corpus', 'gen9nope-1.json'), JSON.stringify({ log: SINGLES }));
      const found = await bankLogs(dir, dir, { fetcher: () => Promise.reject(new Error('offline')) });
      expect(found).toEqual({ ids: 2, missing: 1, logs: [SINGLES] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the CLI prints the fixtures column as a table and as JSON', () => {
    const json = spawnSync(process.execPath, [SCRIPT, '--columns', 'fixtures', '--json'], { cwd: REPO, encoding: 'utf8' });
    expect(json.status).toBe(0);
    const { columns } = JSON.parse(json.stdout) as { columns: Array<{ name: string; total: number; groups: Record<string, Record<string, number>> }> };
    expect(columns).toHaveLength(1);
    expect(columns[0].name).toBe('fixtures');
    expect(columns[0].total).toBe(fixtureLogs().length);
    expect(columns[0].groups['protocol feature']['Z-move (zeffect)']).toBeGreaterThanOrEqual(1);
    const text = spawnSync(process.execPath, [SCRIPT, '--columns', 'fixtures'], { cwd: REPO, encoding: 'utf8' });
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('Z-move (zeffect)');
    expect(text.stdout).toContain('stalling move (Protect family)');
  });
});
