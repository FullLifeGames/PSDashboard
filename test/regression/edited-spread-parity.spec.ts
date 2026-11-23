import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  applyInferredSpreads, buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLogWithObservations, solveReplaySpreads, toId,
  type OpponentTeamInfo, type RevealedPokemonInfo,
} from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { appTeamSeed, buildAppTeams } from '../../src/lib/app-team-build';
import { replayBuildOptions, replaySolveOptions } from '../../src/lib/team-build-options';
import { fetchSmogonSetAssumptions } from '../../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../../src/lib/smogon-stats';

// What the panel shows is what the battle plays, on the edit path too. Every body of the harness games gets its EVs set by hand at
// the values the panel showed (the edit of one number marks the field manual); the app then solves again and builds. The built nature
// and EVs must equal those of the panel (`applyInferredSpreads` over the edited info), not the solver's nature fitted to its own EVs.
// The games are the feedback harness's tracked fixtures with their pinned Smogon answers, so the sweep runs in a clone. Game types
// are counted apart: singles (Gen 6, Gen 8, Champions OU), doubles (Doubles OU) and VGC (Scarlet/Violet Regulation I, Champions
// Regulation M-C).
const FIXTURES = join('test', 'e2e-feedback', 'fixtures');
const GAMES: { kind: 'singles' | 'doubles' | 'vgc'; id: string }[] = [
  { kind: 'singles', id: 'smogtours-gen6ou-648453' },
  { kind: 'singles', id: 'smogtours-gen6ou-649664' },
  { kind: 'singles', id: 'smogtours-gen6ou-653785' },
  { kind: 'singles', id: 'smogtours-gen6ou-655336' },
  { kind: 'singles', id: 'smogtours-gen8ou-562428' },
  { kind: 'singles', id: 'smogtours-gen8ou-573756' },
  { kind: 'singles', id: 'gen9championsou-2628340185' },
  { kind: 'doubles', id: 'smogtours-gen9doublesou-912045' },
  { kind: 'doubles', id: 'gen9doublesou-2663093831' },
  { kind: 'vgc', id: 'gen9vgc2026regi-2629703929' },
  { kind: 'vgc', id: 'gen9vgc2026regi-2630685175' },
  { kind: 'vgc', id: 'gen9championsvgc2026regmc-2695803506' },
];

const pinnedFetcher = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const key = join(FIXTURES, 'smogon', path.replace(/[^a-z0-9.]+/gi, '_'));
  if (!existsSync(`${key}.json`)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${key}.json`, 'utf-8')) } as unknown as Response;
}) as typeof fetch;

const evsKey = (evs: Partial<Record<string, number>>) => ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(stat => evs[stat] ?? 0).join('/');

/** The set of an info's body: same position first, the species id second (a forme or a stand-in may shift the order). */
const setFor = <T extends { species: string }>(team: T[], info: RevealedPokemonInfo, index: number): T | undefined =>
  toId(team[index]?.species ?? '') === toId(info.species) ? team[index] : team.find(set => toId(set.species) === toId(info.species));

async function sweep(id: string) {
  const replay = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf-8')) as { log: string; formatid: string };
  // Every realm that rebuilds a game loads the Champions mod itself before the resolver is asked (AGENTS.md).
  await loadSimMods(getBranchSimulatorFormat(replay));
  const seed = appTeamSeed(replay.log, parseReplayLogWithObservations(replay.log));
  const usageStats = await fetchSmogonUsageStats(replay.formatid, { fetcher: pinnedFetcher });
  const setAssumptions = await fetchSmogonSetAssumptions({ formatId: replay.formatid, species: seed.species, fetcher: pinnedFetcher });
  const app = buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
  const sides = ['p1', 'p2'] as const;

  // The user edits the EVs of every body at the panel's values; the nature field stays what the panel showed.
  const edited = Object.fromEntries(sides.map(side => {
    const panel = applyInferredSpreads(app[`${side}Info`], side, app.inferredSpreads);
    return [side, { ...panel, pokemon: panel.pokemon.map(mon => ({ ...mon, evs: { value: { ...mon.evs.value }, source: 'manual' as const } })) }];
  })) as Record<'p1' | 'p2', OpponentTeamInfo>;

  const sources = { p1Info: edited.p1, p2Info: edited.p2, usageStats, setAssumptions };
  const solved = solveReplaySpreads(replay.log, seed.observations, replaySolveOptions({ ...sources, speedOrders: seed.speedOrders }));
  const built = buildTeamsFromReplay(replay.log, replayBuildOptions({ ...sources, hpEvidence: seed.hpEvidence }, solved));

  const rows = { checked: 0, skipped: 0, wrong: [] as string[] };
  for (const side of sides) {
    const panel = applyInferredSpreads(edited[side], side, solved);
    const team = side === 'p1' ? built.p1Team : built.p2Team;
    panel.pokemon.forEach((mon, index) => {
      const set = setFor(team, mon, index);
      if (!set || !mon.nature?.value) { rows.skipped += 1; return; }
      rows.checked += 1;
      const shown = `${mon.nature.value} ${evsKey(mon.evs.value)}`;
      const played = `${set.nature} ${evsKey(set.evs)}`;
      if (shown !== played) rows.wrong.push(`${id} ${side}:${mon.species} panel ${shown}, build ${played}`);
    });
  }
  return rows;
}

describe('the panel and the build agree on every body whose EVs are set by hand', () => {
  const counts = new Map<string, number>();
  test.each(GAMES)('$kind $id', async ({ kind, id }) => {
    const rows = await sweep(id);
    counts.set(kind, (counts.get(kind) ?? 0) + rows.checked);
    expect(rows.wrong).toEqual([]);
    expect(rows.checked).toBeGreaterThan(0);
  }, 120_000);

  test('every game type has bodies in the sweep', () => {
    console.log('COUNTS', JSON.stringify([...counts]));
    for (const kind of ['singles', 'doubles', 'vgc']) expect(counts.get(kind) ?? 0).toBeGreaterThan(0);
  });
});
