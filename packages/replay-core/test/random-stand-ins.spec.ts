import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as championsMod from '@pkmn/mods/champions';
import {
  dexOf, inferOpponentTeam, inferReplayFormatId, logRules, registerChampionsDex, simFormats, withStandIns,
  type OpponentTeamInfo,
} from '../src/index.ts';

/**
 * Round 89 (lane B, #117): a game whose format generates its teams (a Random Battle: no team preview, no stats file) fills the bodies
 * a side never showed from the format's random-set data: distinct base species the side does not show, the file's level, one role
 * with its moves, ability and item. The corpus holds no Random Battle, so each row is a log the simulator played (lanes/B/b7-gen.vt.ts:
 * two RandomPlayerAI on teams drawn from the published file) with the entries of that file it reads. Gen 3 singles, Gen 9 Random
 * Doubles, and both Champions formats (the mod registers first, as every host does, round 75).
 */
registerChampionsDex(championsMod as unknown as Parameters<typeof registerChampionsDex>[0], championsMod.Formats as unknown as Parameters<typeof registerChampionsDex>[1]);

interface RandomFixture {
  id: string;
  formatid: string;
  log: string;
  teams: { species: string; level: number }[][];
  randomSets: Record<string, {
    level?: number; abilities?: string[]; items?: string[]; moves?: string[];
    roles?: Record<string, { abilities?: string[]; items?: string[]; moves?: string[] }>;
  }>;
}
const fixture = (id: string) => JSON.parse(readFileSync(new URL(`./fixtures/random-${id}.json`, import.meta.url), 'utf-8')) as RandomFixture;

const ROWS = [
  { label: 'Gen 3 Random Battle (singles)', id: 'gen3randombattle-1', gen: 3, short: { p1: 3, p2: 0 } },
  { label: 'Gen 9 Random Doubles Battle', id: 'gen9randomdoublesbattle-11', gen: 9, short: { p1: 2, p2: 0 } },
  { label: 'Champions Random Battle (singles)', id: 'gen9championsrandombattle-8', gen: 9, short: { p1: 4, p2: 0 } },
  { label: 'Champions Random Doubles Battle', id: 'gen9championsrandomdoublesbattle-18', gen: 9, short: { p1: 2, p2: 0 } },
] as const;

const rawOf = (log: string) => ({ p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') });
const speciesOf = (info: OpponentTeamInfo) => info.pokemon.map(mon => mon.species);
const baseOf = (log: string, name: string) => {
  const species = dexOf(logRules(log)).species.get(name);
  return species.baseSpecies || species.name;
};

describe.each(ROWS)('$label', ({ id, short }) => {
  const game = fixture(id);
  const { log } = game;
  const raw = rawOf(log);

  test('the log shows a short side: the build counted fewer bodies than |teamsize|', () => {
    expect(log).toContain('|teamsize|p1|6');
    expect(raw.p1.pokemon).toHaveLength(6 - short.p1);
    expect(raw.p2.pokemon).toHaveLength(6 - short.p2);
  });

  test('without the data nothing changes (today)', () => {
    expect(withStandIns(raw, log, null)).toBe(raw);
  });

  test('with the data both sides hold six bodies, the shown ones first, the guesses marked', () => {
    const filled = withStandIns(raw, log, null, undefined, game.randomSets);
    for (const side of ['p1', 'p2'] as const) {
      expect(filled[side].pokemon).toHaveLength(6);
      expect(speciesOf(filled[side]).slice(0, raw[side].pokemon.length)).toEqual(speciesOf(raw[side]));
      expect(filled[side].pokemon.filter(mon => mon.standIn)).toHaveLength(short[side]);
    }
    // The side that showed all six is untouched, the same object.
    expect(filled.p2).toBe(raw.p2);
  });

  test('a guess is a species of the file the side does not show, distinct by base species, with a set of the file', () => {
    const filled = withStandIns(raw, log, null, undefined, game.randomSets);
    for (const side of ['p1', 'p2'] as const) {
      const bases = filled[side].pokemon.map(mon => baseOf(log, mon.species));
      expect(new Set(bases).size).toBe(bases.length);
      const guesses = filled[side].pokemon.filter(entry => entry.standIn);
      expect(guesses).toHaveLength(short[side]);
      for (const mon of guesses) {
        const entry = game.randomSets[mon.species];
        expect(entry, mon.species).toBeDefined();
        expect(mon.level).toBe(entry.level ?? 100);
        const sets = Object.values(entry.roles ?? {}).length > 0 ? Object.values(entry.roles!) : [entry];
        const set = sets.find(candidate => mon.moves.every(move => (candidate.moves ?? []).includes(move.name)));
        expect(set, `${mon.species}: its moves come from one role`).toBeDefined();
        expect(mon.moves).toHaveLength(Math.min(4, set!.moves!.length));
        expect(mon.moves.every(move => move.source === 'guessed')).toBe(true);
        if (set!.abilities?.length) expect(set!.abilities).toContain(mon.ability.value);
        if (set!.items?.length) expect(set!.items).toContain(mon.item.value);
        expect(mon.ability.source).toBe(set!.abilities?.length ? 'guessed' : 'unknown');
      }
    }
  });

  test('the same game always gets the same guess', () => {
    const first = withStandIns(raw, log, null, undefined, game.randomSets);
    const second = withStandIns(rawOf(log), log, null, undefined, game.randomSets);
    expect(second).toEqual(first);
  });

  test('the draw reads the log header: another game gets its own draw', () => {
    const base = withStandIns(raw, log, null, undefined, game.randomSets).p1;
    const others = [1, 2, 3, 4, 5, 6].map(n => {
      const other = log.replace('|player|p1|Alice|', `|player|p1|Alice${n}|`);
      return speciesOf(withStandIns(rawOf(other), other, null, undefined, game.randomSets).p1).join();
    });
    expect(others.some(names => names !== speciesOf(base).join())).toBe(true);
  });

  test('a pasted body still comes before a guess', () => {
    const wanted = Object.keys(game.randomSets).find(name => !speciesOf(raw.p1).includes(name))!;
    const filled = withStandIns(raw, log, null, { p1: [{ species: wanted }] }, game.randomSets);
    expect(speciesOf(filled.p1)).toContain(wanted);
    expect(filled.p1.pokemon.find(mon => mon.species === wanted)?.standIn).toBeUndefined();
  });
});

describe('which formats fill: the Dex entry decides, never a name', () => {
  // Species that exist from Generation 1 on, so every generation has a legal pool.
  const POOL: Record<string, { level: number; moves: string[] }> = Object.fromEntries(
    ['Bulbasaur', 'Charmander', 'Squirtle', 'Pikachu', 'Eevee', 'Snorlax', 'Gengar', 'Alakazam', 'Machamp', 'Gyarados']
      .map(name => [name, { level: 80, moves: ['Tackle', 'Growl', 'Protect', 'Rest'] }]));
  const synthetic = (tier: string, gen: number) => [
    '|gametype|singles', '|player|p1|a|', '|player|p2|b|', `|gen|${gen}`, `|tier|${tier}`, '|teamsize|p1|6', '|teamsize|p2|6', '|start',
    '|switch|p1a: Mew|Mew, L80|100/100', '|switch|p2a: Mewtwo|Mewtwo, L80|100/100', '|turn|1',
  ].join('\n');

  test('every format the Dex knows fills exactly when its entry generates the team', () => {
    const filled: string[] = [];
    const checked: string[] = [];
    for (const format of simFormats().all()) {
      if (!format.exists || !format.name.startsWith('[Gen ')) continue;
      const log = synthetic(format.name, format.gen);
      if (inferReplayFormatId({ log }) !== format.id) continue;
      const raw = rawOf(log);
      const changed = withStandIns(raw, log, null, undefined, POOL) !== raw;
      checked.push(format.id);
      if (changed) filled.push(format.id);
      expect(changed, format.id).toBe(!!format.team);
    }
    // The sweep reaches the random formats of several generations, both Champions ones, and plenty that generate nothing.
    expect(filled.length).toBeGreaterThanOrEqual(12);
    expect(filled).toContain('gen9championsrandombattle');
    expect(filled).toContain('gen9randomdoublesbattle');
    expect(checked.length - filled.length).toBeGreaterThan(100);
  });
});
