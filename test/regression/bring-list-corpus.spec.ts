import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  broughtSpeciesFor, getBranchSimulatorFormat, getReplayBringCount, inferOpponentTeam, parseReplayLog, replayBringOnly, replayRules,
  speciesBaseId, type ReplayData,
} from '@fulllifegames/replay-core';
import { loadSimMods, serializePreviewPosition } from '@fulllifegames/eval-engine';

/**
 * Round 89 (#116): a Ditto that copied a foe stood in the snapshot as the foe's species, and the bring list named the copy.
 * Two rows over every bring-limited game of `.fit-corpus` (Scarlet/Violet VGC, Champions VGC, Battle Stadium Singles; skipped
 * without the corpus):
 *  - no side's list holds a base species outside the side's own `|poke|` preview (a copy that the side did not preview was a
 *    stranger on the list);
 *  - every game that pins (both sides fielded their whole selection) trims both sides to the bring count with the team the
 *    log alone gives (the team-preview position the lead picker builds, which trims by the list): the list names a body for each
 *    set, so the rebuild plays four against four (three against three), never four against six.
 */
const FIT = join(process.cwd(), '.fit-corpus');
const HAVE_CORPUS = existsSync(FIT);

interface Game { id: string; source: ReplayData; count: number }

function bringLimitedGames(): Game[] {
  const games: Game[] = [];
  for (const name of readdirSync(FIT)) {
    if (!/(vgc|battlestadium).*\.json$/.test(name) || name.startsWith('samples-cache')) continue;
    const json = JSON.parse(readFileSync(join(FIT, name), 'utf8')) as ReplayData;
    if (typeof json?.log !== 'string') continue;
    const id = String(json.id ?? name.replace(/\.json$/, ''));
    const source = { ...json, id, formatid: json.formatid ?? id.replace(/-\d.*$/, '') };
    const count = getReplayBringCount(source);
    if (count !== null) games.push({ id, source, count });
  }
  return games;
}

const SIDES = ['p1', 'p2'] as const;
const previewOf = (log: string, side: string) => [...log.matchAll(new RegExp(`^\\|poke\\|${side}\\|([^|,]+)`, 'gm'))].map(match => match[1]);

describe.skipIf(!HAVE_CORPUS)('the bring lists of the corpus (#116)', () => {
  test('no list holds a base species outside its side\'s preview', async () => {
    await loadSimMods('gen9championsvgc2026regmbbo3');
    const games = bringLimitedGames();
    expect(games.length).toBeGreaterThan(3000);
    const strangers: string[] = [];
    for (const { id, source } of games) {
      const rules = replayRules(source);
      const snapshots = parseReplayLog(source.log);
      for (const side of SIDES) {
        const preview = new Set(previewOf(source.log, side).map(name => speciesBaseId(name, rules)));
        for (const species of broughtSpeciesFor(snapshots, side, rules)) if (!preview.has(speciesBaseId(species, rules))) strangers.push(`${id} ${side}: ${species}`);
      }
    }
    expect(strangers).toEqual([]);
  }, 240_000);

  test('every game that pins trims both sides to the bring count', async () => {
    await loadSimMods('gen9championsvgc2026regmbbo3');
    const games = bringLimitedGames();
    let pinned = 0;
    const wrong: string[] = [];
    for (const { id, source, count } of games) {
      const brought = replayBringOnly(source, parseReplayLog(source.log));
      if (!brought) continue;
      pinned++;
      const team = (side: 'p1' | 'p2') => inferOpponentTeam(source.log, side).pokemon.map(entry => ({
        name: entry.name ?? entry.species, species: entry.species, item: '', ability: '', moves: ['Protect'], nature: 'Serious',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
      }));
      const p1Team = team('p1');
      const p2Team = team('p2');
      const serialized = serializePreviewPosition(getBranchSimulatorFormat(source), p1Team, p2Team, brought);
      if (!serialized) { wrong.push(`${id}: no preview position`); continue; }
      const sides = (JSON.parse(serialized) as { sides: { pokemon: unknown[] }[] }).sides;
      sides.forEach((side, index) => {
        if (side.pokemon.length !== count) wrong.push(`p${index + 1} of ${id}: ${side.pokemon.length} of ${count} (team of ${(index === 0 ? p1Team : p2Team).length})`);
      });
    }
    // Round 89: 3,190 of the corpus' 4,033 bring-limited games pin once the copy no longer takes the Ditto's place.
    expect(pinned).toBeGreaterThan(3000);
    expect(wrong).toEqual([]);
  }, 240_000);
});
