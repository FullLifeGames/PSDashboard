import { test, expect, describe } from 'vitest';
import { fetchReplay, parseReplayUrl, parseReplayViewpoint } from '../src/lib/replay-fetcher';
import { getBranchSimulatorFormat } from '@fulllifegames/replay-core';

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

describe('replay fetcher', () => {
  // A private replay link carries a 31-character password as a `-{password}pw`
  // suffix on the id. The suffix belongs in the fetched id and nowhere else:
  // read as part of the format it produced `gen9ou2632003305e10u...pw`, so an
  // ordinary private OU replay branched as a rule-less custom game (G22).
  const privateId = 'gen9ou-2632003305-e10u50b7xrkmn0w7j5q2bac68relhlwpw';
  const privateLog = '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n|turn|1';

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
