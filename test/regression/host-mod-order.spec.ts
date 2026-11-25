import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { inferOpponentTeam, parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { loadReplayMods } from '../../src/lib/replay-mods';

// A Champions game reads the registered Champions Dex, which loads on demand; without it the inference throws.
const fixture = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as ReplayData;
const SINGLES = fixture('packages/eval-engine/test/fixtures/champions/gen9championsou-2693832490.json');
const DOUBLES = fixture('packages/eval-engine/test/fixtures/champions/gen9championsvgc2026regmbbo3-2679053861.json');
const STANDARD = fixture('packages/eval-engine/test/fixtures/gen9ou-2658662321.json');

describe('the load order', () => {
  test('a replay of another format loads nothing, and its inference needs nothing', async () => {
    expect(Dex.dexes.champions).toBeUndefined();
    await loadReplayMods(STANDARD);
    expect(Dex.dexes.champions).toBeUndefined();
    expect(inferOpponentTeam(STANDARD.log, 'p2').pokemon.length).toBeGreaterThan(0);
    expect(Dex.dexes.champions).toBeUndefined();
  });

  test('a Champions replay (singles or doubles) throws before the load and infers after it', async () => {
    expect(Dex.dexes.champions).toBeUndefined();
    for (const replay of [SINGLES, DOUBLES]) expect(() => inferOpponentTeam(replay.log, 'p2')).toThrow(/Champions mod is not registered/);
    await loadReplayMods(SINGLES);
    expect(Dex.dexes.champions).toBeDefined();
    for (const replay of [SINGLES, DOUBLES]) {
      expect(inferOpponentTeam(replay.log, 'p1').pokemon.length).toBeGreaterThan(0);
      expect(inferOpponentTeam(replay.log, 'p2').pokemon.length).toBeGreaterThan(0);
    }
  });
});

describe('the bank\'s team build', () => {
  test('loads the mod itself: the build of a Champions replay needs no earlier load', async () => {
    const parsed = parseReplayLogWithObservations(DOUBLES.log);
    const built = await bankTeamsFor({ log: DOUBLES.log, formatId: DOUBLES.formatid ?? DOUBLES.id, parsed, fetcher: undefined });
    expect(built.reason).toBeNull();
    expect(built.teams?.p1Team.length).toBeGreaterThan(0);
  });
});

describe('every host awaits the load before it infers', () => {
  const hosts: [string, RegExp][] = [
    ['src/hooks/useReplay.ts', /inferOpponentTeam\(/],
    ['test/regression/bank-build.ts', /buildTeamsFromReplay\(/],
    ['test/regression/eval-calibration.spec.ts', /buildTeamsFromReplay\(replay\.log/],
    ['test/regression/eval-fit.spec.ts', /buildTeamsFromReplay\(replay\.log/],
  ];
  test.each(hosts)('%s', (path, infers) => {
    const text = readFileSync(path, 'utf8');
    const load = text.search(/await loadReplayMods\(/);
    const infer = text.search(infers);
    expect(load, `${path} awaits loadReplayMods`).toBeGreaterThan(-1);
    expect(infer, `${path} infers`).toBeGreaterThan(-1);
    expect(load, `${path} loads before it infers`).toBeLessThan(infer);
  });

  test('the feedback harness infers in the app, through the replay load, and in its Node half only parses', () => {
    const drift = readFileSync('test/e2e-feedback/feedback-drift.spec.ts', 'utf8');
    expect(drift).not.toMatch(/inferOpponentTeam|buildTeamsFromReplay|buildAppTeams/);
  });
});
