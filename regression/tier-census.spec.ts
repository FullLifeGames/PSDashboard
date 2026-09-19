import { test, expect, describe } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReplayGameType } from '@fulllifegames/replay-core';
import {
  censusLines, censusOfDump, gameTypeFromDump, gameTypeOfLog, movedLines, movedTurns, resolveGameType,
} from '../scripts/tier-census.mjs';

/**
 * scripts/tier-census.mjs is the instrument of standing rule D21: it counts
 * the verdict tiers of feedback dump folders and names the turns behind a
 * changed count. The script is unlinted and untyped, so this spec is its only
 * gate. The dumps here are hand-built: the builder below IS the list of dump
 * fields the tool reads.
 */

interface SideInit {
  tier?: 'inaccuracy' | 'mistake' | 'blunder';
  regret?: number;
  unmatched?: boolean;
  choice?: string;
  slots?: boolean;
  partial?: boolean;
  riskPaidOff?: boolean;
}

const side = (init: SideInit = {}) => ({
  playedRaw: null,
  played: init.unmatched ? null : { choice: init.choice ?? 'move tackle', label: 'Tackle' },
  best: { choice: init.choice ?? 'move tackle', label: 'Tackle' },
  safe: { choice: 'move tackle', label: 'Tackle' },
  regret: init.unmatched ? null : init.regret ?? 0,
  choiceCount: 4,
  viableCount: 2,
  // A nested tier that is no verdict: a key scan would count it.
  sensitivity: { alternatives: [{ tier: 'blunder' }] },
  ...(init.tier ? { tier: init.tier } : {}),
  ...(init.slots ? { playedSlots: [null, null] } : {}),
  ...(init.partial ? { playedPartial: true } : {}),
  ...(init.riskPaidOff ? { riskPaidOff: true } : {}),
});
const turn = (n: number, attribution: string, p1: SideInit = {}, p2: SideInit = {}) =>
  ({ turn: n, attribution, p1: side(p1), p2: side(p2) });
const dumpOf = (analyses: (ReturnType<typeof turn> | null)[]) =>
  ({ graph: {}, analyses, gameReport: { misplays: [{ turn: 1, side: 'p1', tier: 'blunder' }] }, haxAlignment: null });

function folders(layout: Record<string, Record<string, ReturnType<typeof dumpOf>>>, logs: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'tier-census-'));
  const fixtures = join(root, 'fixtures');
  mkdirSync(fixtures);
  for (const [id, log] of Object.entries(logs)) writeFileSync(join(fixtures, `${id}.json`), JSON.stringify({ id, log }));
  const paths: Record<string, string> = {};
  for (const [name, dumps] of Object.entries(layout)) {
    paths[name] = join(root, name);
    mkdirSync(paths[name]);
    for (const [id, dump] of Object.entries(dumps)) writeFileSync(join(paths[name], `feedback-full-${id}.json`), JSON.stringify(dump));
  }
  return { fixtures, paths };
}

const SINGLES_LOG = '|j|a\n|gametype|singles\n|turn|1\n';
const DOUBLES_LOG = '|j|a\n|gametype|doubles\n|turn|1\n';
const pairSide: SideInit = { choice: 'move fakeout 1, move protect', slots: true };

describe('tier census', () => {
  test('a dump counts its side verdicts, its unmatched sides and its marks, and nothing nested', () => {
    const count = censusOfDump(dumpOf([
      turn(1, 'quiet', { tier: 'inaccuracy', regret: 0.12 }, {}),
      null,
      turn(3, 'p1-decision', { tier: 'blunder', regret: 0.43, riskPaidOff: true }, { unmatched: true }),
      turn(4, 'quiet', { tier: 'mistake', regret: 0.2, partial: true }, { tier: 'inaccuracy', regret: 0.1 }),
    ]));
    expect(count).toEqual({
      turns: 3, sides: 6, unmatched: 1, inaccuracy: 2, mistake: 1, blunder: 1, partial: 1, riskPaidOff: 1,
      attribution: { quiet: 2, 'p1-decision': 1 },
    });
  });

  test('the game type rule is getReplayGameType to the letter', () => {
    const fixtureDir = fileURLToPath(new URL('../e2e-feedback/fixtures', import.meta.url));
    const logs = readdirSync(fixtureDir).filter(name => name.endsWith('.json'))
      .map(name => (JSON.parse(readFileSync(join(fixtureDir, name), 'utf-8')) as { log: string }).log);
    expect(logs.length).toBeGreaterThanOrEqual(6);
    const odd = [undefined, '', '|gametype|Doubles', '|gametype|Free-For-All\n', 'x|gametype|doubles', '|j|a\n|gametype|triples|x\n'];
    for (const log of [...logs, ...odd]) expect(gameTypeOfLog(log)).toBe(getReplayGameType(log));
    expect(gameTypeOfLog('x|gametype|doubles')).toBeNull();
    expect(gameTypeOfLog(DOUBLES_LOG)).toBe('doubles');
  });

  test('a doubles dump shows in its own marks, and the fixture log decides', () => {
    // A singles Mega label carries " + ", never ", ": no doubles mark.
    expect(gameTypeFromDump(dumpOf([turn(1, 'quiet', { choice: 'move icepunch mega' })]))).toBe('singles');
    expect(gameTypeFromDump(dumpOf([turn(1, 'quiet', { choice: 'move fakeout 1, move protect' })]))).toBe('doubles');
    expect(gameTypeFromDump(dumpOf([turn(1, 'quiet', { slots: true })]))).toBe('doubles');
    const { fixtures } = folders({}, { 'game-d': DOUBLES_LOG, 'game-s': SINGLES_LOG });
    expect(resolveGameType('game-d', dumpOf([turn(1, 'quiet', pairSide)]), fixtures)).toBe('doubles');
    expect(() => resolveGameType('game-s', dumpOf([turn(1, 'quiet', pairSide)]), fixtures)).toThrow(/fixture log says singles/);
    // No fixture: the dump's marks stand alone.
    expect(resolveGameType('unknown', dumpOf([turn(1, 'quiet', pairSide)]), fixtures)).toBe('doubles');
  });

  test('the table lists the union of replays, split by game type, and names what a folder lacks', () => {
    const singles = dumpOf([turn(1, 'quiet', { tier: 'inaccuracy', regret: 0.1 }), turn(2, 'shift', {}, { unmatched: true })]);
    const doubles = dumpOf([turn(1, 'chance', { ...pairSide, tier: 'mistake', regret: 0.25, partial: true }, pairSide)]);
    const { fixtures, paths } = folders(
      { base: { 'game-s': singles }, next: { 'game-s': singles, 'game-d': doubles } },
      { 'game-s': SINGLES_LOG, 'game-d': DOUBLES_LOG });
    const lines = censusLines([paths.base, paths.next], fixtures);
    expect(lines).toEqual([
      `tiers as inaccuracy/mistake/blunder per side-turn; columns: ${paths.base} | ${paths.next}`,
      ' singles:',
      '   game-s                                 1/0/0 |     1/0/0',
      '   TOTAL singles (1 replays)          1/0/0 (4 sides, 1 unmatched, 0 partial) | 1/0/0 (4 sides, 1 unmatched, 0 partial)',
      '   attribution per turn               quiet 1, shift 1 | quiet 1, shift 1',
      ' doubles:',
      '   game-d                                     - |     0/1/0',
      '   TOTAL doubles (1 replays)          0/0/0 (0 sides, 0 unmatched, 0 partial) | 0/1/0 (2 sides, 0 unmatched, 1 partial)',
      '   attribution per turn               chance 0 | chance 1',
      ' not in every folder: game-d',
    ]);
  });

  test('moved turns join on the turn number and carry regret, match and marks', () => {
    const base = dumpOf([
      turn(1, 'quiet'),
      turn(2, 'quiet', { tier: 'inaccuracy', regret: 0.215 }),
      turn(3, 'shift', {}, {}),
      turn(4, 'quiet', {}, {}),
    ]);
    // The next dump lost turn 1 (a null slot shifts every index) and moved three verdicts.
    const next = dumpOf([
      null,
      turn(2, 'p1-read', { tier: 'blunder', regret: 0.43, riskPaidOff: true }),
      turn(3, 'quiet', {}, {}),
      turn(4, 'quiet', {}, { unmatched: true }),
    ]);
    const moved = movedTurns(base, next);
    expect(moved.map(entry => entry.turn)).toEqual([1, 2, 3, 4]);
    expect(moved[0]).toMatchObject({ before: 'quiet|-|-', after: 'absent' });
    expect(moved[1]).toMatchObject({ before: 'quiet|inaccuracy|-', after: 'p1-read|blunder|-' });
    expect(moved[1].sides).toEqual([{
      side: 'p1',
      before: { tier: 'inaccuracy', regret: 0.215, matched: true, marks: [] },
      after: { tier: 'blunder', regret: 0.43, matched: true, marks: ['riskPaidOff'] },
    }]);
    expect(moved[2]).toMatchObject({ before: 'shift|-|-', after: 'quiet|-|-', sides: [] });
    expect(moved[3].sides.map(entry => `${entry.side}:${entry.before.matched}->${entry.after.matched}`)).toEqual(['p2:true->false']);
    expect(movedTurns(base, base)).toEqual([]);

    const { fixtures, paths } = folders(
      { base: { 'game-s': base, 'only-base': base }, next: { 'game-s': next, 'only-next': next } },
      { 'game-s': SINGLES_LOG });
    const lines = movedLines(paths.base, paths.next, fixtures);
    expect(lines).toContain(' game-s (singles): 4 turns');
    expect(lines).toContain('   t2: quiet|inaccuracy|- -> p1-read|blunder|-');
    expect(lines).toContain('     p1: inaccuracy -> blunder, regret 0.215 -> 0.430 [riskPaidOff]');
    expect(lines).toContain('     p2: - -> -, regret 0.000 -> n/a, played matched -> unmatched');
    expect(lines).toContain(' moved turns in total: 4');
    expect(lines).toContain(' only in the base folder: only-base');
    expect(lines).toContain(' only in the next folder: only-next');
  });
});
