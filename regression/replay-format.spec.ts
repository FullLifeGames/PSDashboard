import { test, expect } from '@playwright/test';
import { fetchReplay, parseReplayUrl, parseReplayViewpoint } from '../src/lib/replay-fetcher';
import {
  formatEnforcesSleepClause,
  getBranchSimulatorFormat,
  getReplayGameType,
  inferReplayFormatId,
  splitReplayPassword,
} from '../packages/replay-core/src/replay-format';

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

  test('unknown singles formats run as custom games with Sleep Clause resolved from the log', () => {
    // Declared |rule| line → the clause rides the format as a custom rule.
    expect(getBranchSimulatorFormat({
      id: 'gen9draft-123',
      log: '|gametype|singles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // Rules declared but no sleep clause among them → none injected.
    expect(getBranchSimulatorFormat({
      id: 'gen9draft-123',
      log: '|gametype|singles\n|gen|9\n|rule|OHKO Clause: OHKO moves are banned',
    })).toBe('gen9customgame');

    // A colon-less |rule| line is a pipeline watermark, not a ruleset —
    // the singles default still applies (GPL video reconstructions).
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: '|gametype|singles\n|gen|9\n|rule|Reconstructed from video by gpl-pipeline - best effort',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // NO rule lines at all (video pipelines): singles-standard default.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] Custom Game',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // …unless the log itself shows a second simultaneous sleep.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: [
        '|gametype|singles', '|gen|9', '|tier|[Gen 9] Custom Game',
        '|move|p1a: A|Spore|p2a: X', '|-status|p2a: X|slp',
        '|move|p1a: A|Spore|p2a: Y', '|-status|p2a: Y|slp',
      ].join('\n'),
    })).toBe('gen9customgame');

    // Rest sleeps never count against the clause detection.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: [
        '|gametype|singles', '|gen|9', '|tier|[Gen 9] Custom Game',
        '|move|p1a: A|Spore|p2a: X', '|-status|p2a: X|slp',
        '|move|p2a: Y|Rest|p2a: Y', '|-status|p2a: Y|slp|[from] move: Rest',
      ].join('\n'),
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // Real formats are their own rule authority and never get suffixed:
    // gen3ou carries the clause natively; gen9 OU bans sleep moves instead.
    expect(getBranchSimulatorFormat({
      id: 'gen9ou-123',
      log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU',
    })).toBe('gen9ou');
    expect(formatEnforcesSleepClause('gen3ou')).toBe(true);
    expect(formatEnforcesSleepClause('gen9ou')).toBe(false);
    expect(formatEnforcesSleepClause('gen9customgame')).toBe(false);
    expect(formatEnforcesSleepClause('gen9customgame@@@Sleep Clause Mod')).toBe(true);
  });

  test('parseReplayUrl accepts URL variants and rejects non-replay input (G2)', () => {
    expect(parseReplayUrl('https://replay.pokemonshowdown.com/gen9ou-123?p2')).toBe('gen9ou-123');
    expect(parseReplayUrl('http://replay.pokemonshowdown.com/gen9ou-123.json')).toBe('gen9ou-123');
    expect(parseReplayUrl('  gen9ou-123 ')).toBe('gen9ou-123');
    expect(parseReplayUrl('gen9ou-123.json')).toBe('gen9ou-123');
    // A bare id keeps working when the Showdown query flags ride along.
    expect(parseReplayUrl('gen9ou-123?p2')).toBe('gen9ou-123');

    expect(parseReplayUrl('')).toBeNull();
    expect(parseReplayUrl('   ')).toBeNull();
    expect(parseReplayUrl('https://example.com/foo')).toBeNull();
    expect(parseReplayUrl('not a replay!')).toBeNull();
  });

  test('parseReplayViewpoint reads the ?p2 perspective flag off a replay link', () => {
    expect(parseReplayViewpoint('https://replay.pokemonshowdown.com/gen9ou-123?p2')).toBe('p2');
    expect(parseReplayViewpoint('https://replay.pokemonshowdown.com/gen9ou-123?turn=5&p2')).toBe('p2');
    expect(parseReplayViewpoint('gen9ou-123?p2')).toBe('p2');

    expect(parseReplayViewpoint('https://replay.pokemonshowdown.com/gen9ou-123')).toBe('p1');
    // An explicit ?p1 names the default side.
    expect(parseReplayViewpoint('https://replay.pokemonshowdown.com/gen9ou-123?p1')).toBe('p1');
    // The flag is the literal "p1"/"p2" query key, not any substring.
    expect(parseReplayViewpoint('https://replay.pokemonshowdown.com/gen9ou-123?p2x')).toBe('p1');
    expect(parseReplayViewpoint('gen9ou-p2-123')).toBe('p1');
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

  test('fetchReplay carries the ?p2 viewpoint onto the replay data', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'smogtours-gen8ou-573756',
      format: '[Gen 8] OU',
      players: ['A', 'B'],
      log: '|gen|8\n|tier|[Gen 8] OU',
      uploadtime: 0,
      views: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    try {
      const p2 = await fetchReplay('https://replay.pokemonshowdown.com/smogtours-gen8ou-573756?p2');
      expect(p2.viewpoint).toBe('p2');
      const plain = await fetchReplay('https://replay.pokemonshowdown.com/smogtours-gen8ou-573756');
      expect(plain.viewpoint).toBeUndefined();
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
  // A private replay link carries a 31-character password as a `-{password}pw`
  // suffix on the id. The suffix belongs in the fetched id and nowhere else:
  // read as part of the format it produced `gen9ou2632003305e10u...pw`, so an
  // ordinary private OU replay branched as a rule-less custom game (G22).
  const privateId = 'gen9ou-2632003305-e10u50b7xrkmn0w7j5q2bac68relhlwpw';
  const privateLog = '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n|turn|1';

  test('splitReplayPassword parses the private-replay suffix (G22)', () => {
    expect(splitReplayPassword(privateId))
      .toEqual(['gen9ou-2632003305', 'e10u50b7xrkmn0w7j5q2bac68relhlw']);
    expect(splitReplayPassword('gen9ou-2632003305')).toEqual(['gen9ou-2632003305', null]);
    expect(splitReplayPassword('smogtours-gen3ou-56583')).toEqual(['smogtours-gen3ou-56583', null]);
  });

  test('a private replay id infers its real format, not its password (G22)', () => {
    expect(inferReplayFormatId({ id: privateId, log: privateLog })).toBe('gen9ou');
    expect(getBranchSimulatorFormat({ id: privateId, log: privateLog })).toBe('gen9ou');
  });

  test('parseReplayUrl keeps the password suffix the replay server needs (G22)', () => {
    expect(parseReplayUrl(`https://replay.pokemonshowdown.com/${privateId}`)).toBe(privateId);
    expect(parseReplayUrl(privateId)).toBe(privateId);
  });

  test('fetchReplay falls back to the .log route when .json refuses (G22)', async () => {
    const originalFetch = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      // The JSON route rejects at the network layer, exactly as a CORS-less
      // 404 from the replay host does in a browser.
      if (String(url).endsWith('.json')) throw new TypeError('Failed to fetch');
      return new Response(`|player|p1|Alpha|\n|player|p2|Beta|\n${privateLog}`, { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const replay = await fetchReplay(`https://replay.pokemonshowdown.com/${privateId}`);
      expect(asked).toEqual([
        `https://replay.pokemonshowdown.com/${privateId}.json`,
        `https://replay.pokemonshowdown.com/${privateId}.log`,
      ]);
      expect(replay.id).toBe(privateId);
      expect(replay.formatid).toBe('gen9ou');
      expect(replay.format).toBe('[Gen 9] OU');
      expect(replay.players).toEqual(['Alpha', 'Beta']);
      expect(replay.log).toContain('|turn|1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchReplay treats a non-JSON body as a failed JSON route (G22)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => (String(url).endsWith('.json')
      ? new Response('<!DOCTYPE html><title>404</title>', { status: 200 })
      : new Response(`|player|p1|Alpha|\n|player|p2|Beta|\n${privateLog}`, { status: 200 }))) as unknown as typeof fetch;

    try {
      const replay = await fetchReplay(privateId);
      expect(replay.formatid).toBe('gen9ou');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchReplay keeps JSON metadata when only the log route has the battle', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => (String(url).endsWith('.json')
      ? new Response(JSON.stringify({
        id: 'gen9ou-2632003305', format: '[Gen 9] OU', formatid: 'gen9ou',
        players: ['Alpha', 'Beta'], log: '', uploadtime: 1782410309, views: 7,
      }), { status: 200 })
      : new Response(privateLog, { status: 200 }))) as unknown as typeof fetch;

    try {
      const replay = await fetchReplay(privateId);
      expect(replay.id).toBe('gen9ou-2632003305');
      expect(replay.views).toBe(7);
      expect(replay.uploadtime).toBe(1782410309);
      expect(replay.log).toContain('|turn|1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a private replay that stays unreachable is explained as one (G22)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;

    try {
      await expect(fetchReplay(privateId)).rejects.toThrow(/private replay link/i);
      await expect(fetchReplay('gen9ou-2632003305')).rejects.toThrow(/Double-check the replay id/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a replay record without any battle log says so (G22)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => (String(url).endsWith('.json')
      ? new Response(JSON.stringify({
        id: 'gen9ou-2632003305', format: '[Gen 9] OU', players: ['Alpha', 'Beta'],
        log: '', uploadtime: 0, views: 0,
      }), { status: 200 })
      : new Response('', { status: 404 }))) as unknown as typeof fetch;

    try {
      await expect(fetchReplay('gen9ou-2632003305')).rejects.toThrow(/without a battle log/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
