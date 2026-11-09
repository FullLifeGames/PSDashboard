import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBranchSimulatorFormat, getReplayBringCount, inferOpponentTeam, parseReplayLog, replayBringList, replayRules, speciesBaseId, type ReplayData,
} from '@fulllifegames/replay-core';
import type { PokemonSet } from '@pkmn/sim';
import { BRING_WORLD_CAP, bringWorlds, type BringWorld } from '../src/branch/bring-worlds';
import { serializePreviewPosition } from '../src/branch-engine';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 89 (#124, stage 1): the worlds of every bring-limited game of `.fit-corpus` (Scarlet/Violet VGC, Champions VGC bo1 and
 * bo3, Battle Stadium Singles; skipped without the corpus). Each world, with equal weights, names only bodies of its side's team
 * preview, holds the bring count on both sides, puts the guesses last, and trims both sides to the count through the team-preview
 * position (`serializePreviewPosition`, the trim of the rebuild): no world pits a pinned four against an open six. The root spec
 * `bring-list-corpus.spec.ts` holds the lists of `replayBringOnly`; the engine's zone keeps this row in the package.
 */
const FIT = join(process.cwd(), '.fit-corpus');
const HAVE_CORPUS = existsSync(FIT);

type Family = 'VGC SV' | 'Champions VGC bo1' | 'Champions VGC bo3' | 'BSS';
const familyOf = (formatid: string): Family =>
  /battlestadium/.test(formatid) ? 'BSS' : /championsvgc.*bo3/.test(formatid) ? 'Champions VGC bo3' : /champions/.test(formatid) ? 'Champions VGC bo1' : 'VGC SV';

const SIDES = ['p1', 'p2'] as const;
const previewOf = (log: string, side: string) => [...log.matchAll(new RegExp(`^\\|poke\\|${side}\\|([^|,]+)`, 'gm'))].map(match => match[1]);

type Counts = { games: number; pinned: number; short: number; worlds: number; capped: number };

const blankTeam = (source: ReplayData, side: 'p1' | 'p2') => inferOpponentTeam(source.log, side).pokemon.map(entry => ({
  name: entry.name ?? entry.species, species: entry.species, item: '', ability: '', moves: ['Protect'], nature: 'Serious',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
}));

/** The problems of one world: the list per side, its bodies against the preview, and the trimmed team-preview position. */
function worldProblems(id: string, source: ReplayData, count: number, world: BringWorld, teams: { p1: PokemonSet[]; p2: PokemonSet[] }): string[] {
  const rules = replayRules(source);
  const problems: string[] = [];
  for (const side of SIDES) {
    const preview = new Set(previewOf(source.log, side).map(species => speciesBaseId(species, rules)));
    if (world[side].length !== count) problems.push(`${id} ${side}: a list of ${world[side].length} for ${count}`);
    for (const species of world[side]) if (!preview.has(speciesBaseId(species, rules))) problems.push(`${id} ${side}: ${species} is no preview body`);
  }
  const serialized = serializePreviewPosition(getBranchSimulatorFormat(source), teams.p1, teams.p2, { p1: world.p1, p2: world.p2, guessed: world.guessed });
  if (!serialized) return [...problems, `${id}: no preview position`];
  const sides = (JSON.parse(serialized) as { sides: { pokemon: unknown[] }[] }).sides;
  sides.forEach((side, index) => {
    if (side.pokemon.length !== count) problems.push(`p${index + 1} of ${id}: ${side.pokemon.length} of ${count} (team of ${(index === 0 ? teams.p1 : teams.p2).length})`);
  });
  return problems;
}

function* bringLimitedGames(): Generator<{ id: string; source: ReplayData; count: number }> {
  for (const name of readdirSync(FIT)) {
    if (!/(vgc|battlestadium).*\.json$/.test(name) || name.startsWith('samples-cache')) continue;
    const json = JSON.parse(readFileSync(join(FIT, name), 'utf8')) as ReplayData;
    if (typeof json?.log !== 'string') continue;
    const id = String(json.id ?? name.replace(/\.json$/, ''));
    const source = { ...json, id, formatid: json.formatid ?? id.replace(/-\d.*$/, '') };
    const count = getReplayBringCount(source);
    if (count !== null) yield { id, source, count };
  }
}

describe.skipIf(!HAVE_CORPUS)('the worlds of the corpus (#124)', () => {
  test('every world of every bring-limited game names preview bodies, holds the count on both sides and trims both teams to it', async () => {
    await loadSimMods('gen9championsvgc2026regmbbo3');
    const counts: Record<string, Counts> = {};
    const wrong: string[] = [];
    for (const { id, source, count } of bringLimitedGames()) {
      const family = (counts[familyOf(source.formatid)] ??= { games: 0, pinned: 0, short: 0, worlds: 0, capped: 0 });
      family.games++;
      const list = replayBringList(source, parseReplayLog(source.log));
      const worlds = bringWorlds(list, BRING_WORLD_CAP);
      if (!list || !worlds) { wrong.push(`${id}: no list`); continue; }
      if (list.p1.open > 0 || list.p2.open > 0) family.short++; else family.pinned++;
      family.worlds += worlds.length;
      if (bringWorlds(list, 1000)!.length > BRING_WORLD_CAP) family.capped++;
      const total = worlds.reduce((sum, world) => sum + world.weight, 0);
      if (Math.abs(total - 1) > 1e-9) wrong.push(`${id}: weights sum to ${total}`);
      const teams = { p1: blankTeam(source, 'p1'), p2: blankTeam(source, 'p2') };
      for (const world of worlds) wrong.push(...worldProblems(id, source, count, world, teams));
    }
    // Round 89: 4,033 games (Champions VGC bo1 523, bo3 900, VGC SV 2,610), 3,190 pinned and 843 short (113, 219, 511), 128 of them with more than three worlds.
    const all = Object.values(counts);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.reduce((sum, family) => sum + family.short, 0)).toBeGreaterThan(800);
    expect(all.reduce((sum, family) => sum + family.capped, 0)).toBeGreaterThan(100);
    expect(wrong, JSON.stringify(counts)).toEqual([]);
  }, 600_000);
});
