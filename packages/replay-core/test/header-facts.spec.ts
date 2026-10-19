import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Battle } from '@pkmn/client';
import { generationsFor, getReplayBringCount, getReplayGameType, getReplayGeneration, inferReplayFormatId } from '../src/index.ts';

/**
 * Round 72, T241 step 1a: the header facts of a replay (game type, generation, the number of Pokémon each side brings)
 * are what @pkmn/client's Battle holds after it has read the log's header lines. This spec holds our three readers to the
 * client on every fixture replay of the four fixture folders, and pins the cases the old regexes and the format-name
 * heuristic got wrong or never saw: a format the Dex does not know, a Windows log, odd `|gametype|` lines.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE_DIRS = [
  'packages/replay-core/test/fixtures',
  'regression/fixtures',
  'packages/eval-engine/test/fixtures',
  'packages/eval-engine/test/fixtures/champions',
  'e2e/fixtures',
];

interface Fixture { tag: string; source: { id?: string; format?: string; formatid?: string; log: string } }

function fixtures(): Fixture[] {
  const found: Fixture[] = [];
  for (const dir of FIXTURE_DIRS) {
    const folder = `${root}${dir}`;
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith('.json')) continue;
      let parsed: { id?: string; format?: string; formatid?: string; log?: unknown };
      try { parsed = JSON.parse(readFileSync(`${folder}/${name}`, 'utf8')); } catch { continue; }
      if (typeof parsed.log !== 'string' || !parsed.log.includes('|start')) continue;
      found.push({ tag: `${dir}/${name}`, source: { id: parsed.id, format: parsed.format, formatid: parsed.formatid, log: parsed.log } });
    }
  }
  return found;
}

/** The oracle: the client after the header lines (everything before `|start`), as the plain `battle.add` calls read them. */
function clientAfterHeader(source: Fixture['source']) {
  const lines = source.log.replace(/\r\n?/g, '\n').split('\n');
  const battle = new Battle(generationsFor(inferReplayFormatId(source)));
  for (const line of lines.slice(0, lines.findIndex((l) => l.startsWith('|start')))) if (line.trim()) battle.add(line);
  return { battle, hasGametype: lines.some((l) => l.startsWith('|gametype|')) };
}

/** A log with a header only; what a test varies is the format and the lines. */
const headerLog = (...lines: string[]) => ['|j|a', '|j|b', ...lines, '|start', '|turn|1'].join('\n');

describe('header facts equal the client (fixtures of the four folders, singles, doubles, VGC, Champions, draft, GPL)', () => {
  const all = fixtures();

  test('the sweep finds the fixture replays', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    const types = new Set(all.map((f) => getReplayGameType(f.source.log)));
    expect(types).toContain('singles');
    expect(types).toContain('doubles');
  });

  test.each(all.map((f) => [f.tag, f] as const))('%s', (_tag, fixture) => {
    const { source } = fixture;
    const { battle, hasGametype } = clientAfterHeader(source);
    // A log with no |gametype| line says nothing (the GPL pipeline's), where the client defaults to singles.
    expect(getReplayGameType(source.log)).toBe(hasGametype ? battle.gameType : null);
    expect(getReplayGeneration(source)).toBe(battle.gen.num);
    const brought = battle.teamPreviewCount >= 1 && battle.teamPreviewCount <= 5 ? battle.teamPreviewCount : null;
    expect(getReplayBringCount(source)).toBe(brought);
  });
});

describe('the log names how many each side brings', () => {
  test('doubles: a format id the Dex does not know and no "vgc" in it brings what |teampreview| says', () => {
    const log = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] League Bo3', '|clearpoke', '|teampreview|4');
    expect(getReplayBringCount({ id: 'gen9leaguebo3-1', formatid: 'gen9leaguebo3', log })).toBe(4);
  });

  test('singles: Battle Stadium Singles brings three, also under an id the Dex does not know', () => {
    const log = headerLog('|gametype|singles', '|gen|9', '|tier|[Gen 9] Mystery Singles', '|clearpoke', '|teampreview|3');
    expect(getReplayBringCount({ id: 'gen9mysterysingles-1', formatid: 'gen9mysterysingles', log })).toBe(3);
  });

  test('a log that previews all six brings all, whatever the format id says', () => {
    const log = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC Free For All', '|clearpoke', '|teampreview');
    expect(getReplayBringCount({ id: 'gen9vgcfreeforall-1', formatid: 'gen9vgcfreeforall', log })).toBeNull();
  });

  test('without a |teampreview| line the format decides: the Dex first, then the name', () => {
    const noPreview = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2099');
    expect(getReplayBringCount({ id: 'gen9vgc2099-1', formatid: 'gen9vgc2099', log: noPreview })).toBe(4);
    expect(getReplayBringCount({ id: 'gen9ou-1', formatid: 'gen9ou', log: headerLog('|gametype|singles', '|gen|9') })).toBeNull();
    expect(getReplayBringCount({ id: 'gen9vgc2099-1', formatid: 'gen9vgc2099' })).toBe(4);
    expect(getReplayBringCount({ id: 'gen9battlestadiumsingles-1', formatid: 'gen9battlestadiumsingles' })).toBe(3);
  });

  test('a |teampreview| line after |start belongs to no header', () => {
    const log = ['|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU', '|start', '|teampreview|2'].join('\n');
    expect(getReplayBringCount({ id: 'gen9doublesou-1', formatid: 'gen9doublesou', log })).toBeNull();
  });
});

describe('the same facts from a Windows log and from odd lines', () => {
  const lines = ['|j|a', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] League Bo3', '|clearpoke', '|teampreview|4', '|start', '|turn|1'];

  test('CRLF and CR logs read like LF logs', () => {
    const source = (log: string) => ({ id: 'gen9leaguebo3-1', formatid: 'gen9leaguebo3', log });
    for (const log of [lines.join('\n'), lines.join('\r\n'), lines.join('\r')]) {
      expect(getReplayGameType(log)).toBe('doubles');
      expect(getReplayGeneration(source(log))).toBe(9);
      expect(getReplayBringCount(source(log))).toBe(4);
    }
  });

  test('the generation comes from the log when the format id has none', () => {
    expect(getReplayGeneration({ log: ['|gametype|singles', '|gen|4', '|tier|[Gen 4] OU', '|start'].join('\n') })).toBe(4);
    expect(getReplayGeneration({ log: '|start' })).toBe(9);
    expect(getReplayGeneration({ format: '[Gen 5] OU', log: '|start' })).toBe(5);
  });

  test('odd |gametype| lines (the cases of regression/tier-census.spec.ts)', () => {
    expect(getReplayGameType(undefined)).toBeNull();
    expect(getReplayGameType('')).toBeNull();
    expect(getReplayGameType('|gametype|Doubles')).toBe('doubles');
    expect(getReplayGameType('|gametype|Free-For-All\n')).toBe('freeforall');
    expect(getReplayGameType('x|gametype|doubles')).toBeNull();
    expect(getReplayGameType('|j|a\n|gametype|triples|x\n')).toBe('triples');
    expect(getReplayGameType('|gametype|\n|turn|1')).toBeNull();
    expect(getReplayGameType('|j|a\n|start\n|turn|1')).toBeNull();
  });
});
