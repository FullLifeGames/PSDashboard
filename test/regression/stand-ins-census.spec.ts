import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, TeamValidator, type PokemonSet } from '@pkmn/sim';
import {
  inferOpponentTeam, inferReplayFormatId, missingBodies, registerChampionsDex, rulesDex, simFormats, withStandIns, type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { parseSmogonChaosStats } from '../../src/lib/smogon-stats';
import * as championsMod from '@pkmn/mods/champions';

/**
 * Round 88 (F, #101), sweeps S2 and S3 of the plan.
 * S3: no measured row moves. The step returns the infos unchanged for every log of the bank's replays, the fit corpus (the holdouts'
 *     games among them) and the feedback fixtures, because none has a short side; a tracked row keeps the guard in CI (the feedback
 *     fixtures), the local rows read the data that only the main checkout holds.
 * S2: a stand-in is a body of the game's own Dex that the format's rule table lets in, and never repeats a base species of its side:
 *     for the 34 short sides of the fit corpus and a simulator-made log of every no-preview format with a stats file, the whole team
 *     (shown bodies plus stand-ins) validates in the format, ignoring the problems of sets (moves, abilities, items, spreads: the
 *     stand-ins carry none) and holds six distinct base species.
 */
// The feedback fixtures include Champions games: the mod registers before a log is read, as every host does (round 75).
registerChampionsDex(championsMod as unknown as Parameters<typeof registerChampionsDex>[0], championsMod.Formats as unknown as Parameters<typeof registerChampionsDex>[1]);
const FEEDBACK = 'test/e2e-feedback/fixtures';
const readLog = (path: string): string | null => {
  try {
    const json = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof json.log === 'string' ? json.log : null;
  } catch { return null; }
};

const GEN4 = parseSmogonChaosStats(JSON.parse(readFileSync('test/regression/fixtures/stats-gen4ou-trimmed.json', 'utf-8')), { format: 'gen4ou', month: 'latest' }) as SmogonUsageStats;

const rawOf = (log: string) => ({ p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') });
const unchanged = (log: string) => { const raw = rawOf(log); return withStandIns(raw, log, GEN4) === raw; };

describe('S3: the logs of the measurements have no short side', () => {
  test('the feedback fixtures and the tracked replays come back as they went in', () => {
    const logs = readdirSync(FEEDBACK).filter(name => name.endsWith('.json')).map(name => readLog(`${FEEDBACK}/${name}`)).filter((log): log is string => !!log);
    logs.push(...['smogtours-gen7ou-450650'].map(name => readLog(`test/regression/fixtures/${name}.json`)!));
    expect(logs.length).toBeGreaterThanOrEqual(8);
    expect(logs.filter(log => !unchanged(log))).toHaveLength(0);
  });

  test.skipIf(!existsSync('.fit-corpus') || !existsSync('.calibration/replays'))('the bank, the fit corpus and the holdouts: no side is short in a game with a preview or in the bank', () => {
    const roots = ['.fit-corpus', '.calibration/replays'];
    let games = 0;
    let previewless = 0;
    const short: string[] = [];
    for (const root of roots) {
      for (const name of readdirSync(root).filter(entry => entry.endsWith('.json'))) {
        const log = readLog(`${root}/${name}`);
        if (!log) continue;
        games++;
        if (!/^\|teamsize\|/m.test(log)) continue;
        const preview = /^\|poke\|/m.test(log);
        if (!preview) previewless++;
        // A preview side is never short, whatever it built; a game without preview is short where the inference built fewer bodies.
        const raw = preview ? null : rawOf(log);
        for (const side of ['p1', 'p2'] as const) {
          if (missingBodies(log, raw ? raw[side].pokemon.length : 99, side) > 0) short.push(`${root}/${name}:${side}`);
        }
      }
    }
    expect(games).toBeGreaterThan(5000);
    expect(previewless).toBeGreaterThan(100);
    // The 34 short sides of the fit corpus (gens 2 to 4, singles) are the games the step is for; no other set has one: the bank and
    // the holdouts' own games are not among them.
    const bank = new Set(readdirSync('.calibration/replays').map(name => `.fit-corpus/${name}`));
    expect(short.filter(entry => bank.has(entry.replace(/:p\d$/, '')) || /gen(9|8|7|6|5)/.test(entry))).toEqual([]);
  }, 600_000);
});

/** The stats of a cached format, parsed as the app does; null when the cache holds none (or a 404). */
function cachedStats(format: string): SmogonUsageStats | null {
  if (!existsSync('.smogon-cache')) return null;
  const file = readdirSync('.smogon-cache').find(name => name.includes(`stats-${format}-json`));
  const payload = file ? JSON.parse(readFileSync(`.smogon-cache/${file}`, 'utf-8')).payload : null;
  return payload?.pokemon ? parseSmogonChaosStats(payload, { format, month: 'latest' }) : null;
}

const problemsOfSets = /move|learn|ability|item|hold|EV|IV|Hidden Power|nature|gender|level|happiness|event/i;

/** The problems of the team that concern its species and its clauses, for the bodies in `only` (the shown ones are the log's own) or the clauses. */
function speciesProblems(formatId: string, species: string[], only: string[]): string[] {
  const dex = Dex.forFormat(simFormats().get(formatId));
  const team = species.map(name => {
    const entry = dex.species.get(name);
    const learnset = Object.keys(dex.species.getLearnsetData(entry.id as never)?.learnset ?? {});
    return {
      name: entry.name, species: entry.name, item: '', ability: entry.abilities[0] ?? '', moves: [learnset[0] ?? 'tackle'], nature: '', gender: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
    } as PokemonSet;
  });
  return (new TeamValidator(formatId).validateTeam(team) ?? [])
    .filter(problem => !problemsOfSets.test(problem) && (only.some(name => problem.includes(name)) || /Clause|limited/i.test(problem)));
}

describe('S2: the stand-ins are legal in the format and distinct by base species', () => {
  const formats = ['gen1ou', 'gen2ou', 'gen2ubers', 'gen3ou', 'gen3ubers', 'gen3uu', 'gen3ru', 'gen4ou', 'gen4ubers', 'gen4uu', 'gen4doublesou']
    .filter(format => cachedStats(format));

  test.skipIf(formats.length < 6)('a simulator-made log of every no-preview format with a stats file: its stand-ins fill the team legally', () => {
    const wrong: string[] = [];
    let filledSides = 0;
    for (const format of formats) {
      const stats = cachedStats(format)!;
      const shown = Object.values(stats.pokemon).sort((a, b) => b.rawCount - a.rawCount).slice(0, 6).map(entry => entry.species);
      const dex = Dex.forFormat(simFormats().get(format));
      const set = (name: string) => ({
        name, species: name, item: '', ability: dex.species.get(name).abilities[0] ?? '', moves: ['tackle'], nature: '', gender: '',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
      }) as PokemonSet;
      const team = Teams.pack(shown.map(set));
      const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'a', team }, p2: { name: 'b', team } });
      battle.makeChoices('default', 'default');
      const log = battle.log.join('\n');
      const raw = rawOf(log);
      const filled = withStandIns(raw, log, stats);
      for (const side of ['p1', 'p2'] as const) {
        const names = filled[side].pokemon.map(mon => mon.species);
        if (names.length !== 6) wrong.push(`${format} ${side}: ${names.length} bodies`);
        if (filled[side].pokemon.slice(raw[side].pokemon.length).some(mon => !mon.standIn)) wrong.push(`${format} ${side}: a guess without the flag`);
        const bases = new Set(names.map(name => rulesDex(Number(format.match(/^gen(\d)/)![1])).species.get(name).baseSpecies));
        if (bases.size !== 6) wrong.push(`${format} ${side}: ${names.join(', ')} repeats a base species`);
        for (const problem of speciesProblems(format, names, names.slice(raw[side].pokemon.length))) wrong.push(`${format} ${side}: ${problem}`);
        filledSides++;
      }
    }
    expect(filledSides).toBeGreaterThanOrEqual(12);
    expect(wrong).toEqual([]);
  }, 120_000);

  test.skipIf(!existsSync('.fit-corpus'))('the 34 short sides of the fit corpus (gens 2 to 4): every stand-in is legal in its game\'s format', () => {
    const wrong: string[] = [];
    let sides = 0;
    for (const name of readdirSync('.fit-corpus').filter(entry => /gen[234]/.test(entry) && entry.endsWith('.json'))) {
      const json = JSON.parse(readFileSync(`.fit-corpus/${name}`, 'utf-8')) as { log?: string };
      if (typeof json.log !== 'string') continue;
      const log = json.log;
      const format = inferReplayFormatId({ log });
      const stats = cachedStats(format) ?? cachedStats(`gen${format.match(/^gen(\d)/)?.[1]}ou`);
      if (!stats) continue;
      const raw = rawOf(log);
      const filled = withStandIns(raw, log, stats);
      for (const side of ['p1', 'p2'] as const) {
        if (filled[side] === raw[side]) continue;
        sides++;
        const names = filled[side].pokemon.map(mon => mon.species);
        for (const problem of speciesProblems(format, names, names.slice(raw[side].pokemon.length))) wrong.push(`${name} ${side}: ${problem}`);
        if (new Set(names.map(species => species.split('-')[0])).size !== names.length) wrong.push(`${name} ${side}: repeats a base species`);
      }
    }
    expect(sides).toBeGreaterThanOrEqual(25);
    expect(wrong).toEqual([]);
  }, 300_000);
});
