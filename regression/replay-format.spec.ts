import { test, expect } from '@playwright/test';
import { fetchReplay, parseReplayUrl } from '../src/lib/replay-fetcher';
import {
  getBranchSimulatorFormat,
  getReplayGameType,
  inferReplayFormatId,
} from '../src/lib/replay-format';

const vgcReplay = {
  id: 'gen9championsvgc2026regmb-2639020147',
  format: '[Gen 9 Champions] VGC 2026 Reg M-B',
  players: ['Lacksatives', 'PleaseRememberMe'],
  log: [
    '|j|Lacksatives',
    '|j|PleaseRememberMe',
    '|gametype|doubles',
    '|player|p1|Lacksatives|swimmer-masters|1179',
    '|player|p2|PleaseRememberMe|266|1183',
    '|gen|9',
    '|tier|[Gen 9 Champions] VGC 2026 Reg M-B',
    '|clearpoke',
    '|poke|p1|Scizor, L50, F|',
    '|poke|p1|Rotom-Wash, L50|',
    '|poke|p1|Sneasler, L50, M|',
    '|poke|p1|Tyranitar, L50, M|',
    '|poke|p2|Eelektross, L50, M|',
    '|poke|p2|Annihilape, L50, F|',
    '|poke|p2|Grimmsnarl, L50, M|',
    '|poke|p2|Politoed, L50, M|',
    '|teampreview|4',
    '|start',
    '|switch|p1a: Scizor|Scizor, L50, F|100/100',
    '|switch|p1b: Sneasler|Sneasler, L50, M|100/100',
    '|switch|p2a: Eelektross|Eelektross, L50, M|100/100',
    '|switch|p2b: Annihilape|Annihilape, L50, F|100/100',
    '|turn|1',
  ].join('\n'),
  uploadtime: 1782410309,
  views: 0,
};

test.describe('replay format inference', () => {
  test('infers missing Showdown format ids from replay ids', () => {
    expect(inferReplayFormatId(vgcReplay)).toBe('gen9championsvgc2026regmb');
    expect(getReplayGameType(vgcReplay.log)).toBe('doubles');
  });

  test('normalizes smogtours replay ids to real format ids (B13)', () => {
    expect(inferReplayFormatId({
      id: 'smogtours-gen3ou-56583',
      log: '|gen|3\n|tier|[Gen 3] OU',
    })).toBe('gen3ou');

    // Smogtours ids can omit the generation entirely — it comes from the log.
    expect(inferReplayFormatId({
      id: 'smogtours-ubers-54583',
      log: '|gen|6\n|tier|[Gen 6] Ubers',
    })).toBe('gen6ubers');

    expect(getBranchSimulatorFormat({
      id: 'smogtours-gen3ou-56583',
      log: '|gametype|singles\n|gen|3\n|tier|[Gen 3] OU',
    })).toBe('gen3ou');
  });

  test('maps custom VGC replay formats to a supported doubles simulator format', () => {
    expect(getBranchSimulatorFormat(vgcReplay)).toBe('gen9doublesou');
  });

  test('preserves standard singles simulator formats', () => {
    expect(getBranchSimulatorFormat({
      ...vgcReplay,
      id: 'gen9ou-123',
      format: '[Gen 9] OU',
      formatid: 'gen9ou',
      log: vgcReplay.log.replace('|gametype|doubles', '|gametype|singles'),
    })).toBe('gen9ou');
  });

  test('parseReplayUrl accepts URL variants and rejects non-replay input (G2)', () => {
    expect(parseReplayUrl('https://replay.pokemonshowdown.com/gen9ou-123?p2')).toBe('gen9ou-123');
    expect(parseReplayUrl('http://replay.pokemonshowdown.com/gen9ou-123.json')).toBe('gen9ou-123');
    expect(parseReplayUrl('  gen9ou-123 ')).toBe('gen9ou-123');
    expect(parseReplayUrl('gen9ou-123.json')).toBe('gen9ou-123');

    expect(parseReplayUrl('')).toBeNull();
    expect(parseReplayUrl('   ')).toBeNull();
    expect(parseReplayUrl('https://example.com/foo')).toBeNull();
    expect(parseReplayUrl('not a replay!')).toBeNull();
  });

  test('fetchReplay rejects non-replay input with a clear message (G1/G2)', async () => {
    await expect(fetchReplay('https://example.com/foo')).rejects.toThrow(/replay link or id/i);
    await expect(fetchReplay('')).rejects.toThrow(/replay link or id/i);
  });

  test('fetchReplay adds the generation to display formats that omit it (G5)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'smogtours-ubers-54583',
      format: 'Ubers',
      players: ['A', 'B'],
      log: '|gen|6\n|tier|[Gen 6] Ubers',
      uploadtime: 0,
      views: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    try {
      const replay = await fetchReplay('smogtours-ubers-54583');
      expect(replay.format).toBe('[Gen 6] Ubers');
      expect(replay.formatid).toBe('gen6ubers');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchReplay normalizes replay JSON that omits formatid', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(vgcReplay), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
      const replay = await fetchReplay('https://replay.pokemonshowdown.com/gen9championsvgc2026regmb-2639020147');
      expect(replay.formatid).toBe('gen9championsvgc2026regmb');
      expect(getBranchSimulatorFormat(replay)).toBe('gen9doublesou');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
