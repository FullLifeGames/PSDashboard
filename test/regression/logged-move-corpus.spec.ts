import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Battle, Teams, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { FIXTURES } from './forced-reconstruction-support';
import { checkBuiltSets, loggedBodies, ownerOf, type Gap } from './logged-moves';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';
import games from './fixtures/logged-move-corpus-ids.json';

/**
 * Round 89 (#146): every move the log shows as a body's own is in the set the build makes, on every build path without a user's
 * edit (a pasted or edited set may lack one by the rule that a manual edit beats the log, `team/set-resolvers.ts:78-82`). The oracle
 * is its own reading of the log (`logged-moves.ts`); the sweep holds the inference and the build to it.
 *
 * Paths: `bare` (no Smogon data, `buildTeamsFromReplay`), `bank` (the app's and the bank's build with Smogon data: the feedback
 * fixtures' pinned files, the corpus games' disk cache), `nodata` (the app's chain with every Smogon call answered 404).
 * Rows: the twelve feedback fixtures (tracked, run in CI); the games of `fixtures/logged-move-corpus-ids.json` (local: they skip
 * without `.fit-corpus`): `core` always, the rest of the 300-game sample of the log scan with LOGGED_MOVE_SWEEP=full. Each family is
 * counted apart in the titles (singles, Doubles OU, VGC SV, Champions OU, Champions VGC).
 *
 * Gaps with an owner (the issues that fix them) stand in `OWNED`: each owner has one expected-fail row that passes while its gaps
 * exist and turns red once the fix leaves none, the moment to delete the row. Round 89 gaps: #139 (a transformed body's moves book
 * nowhere), #140 (fixed in round 89: a Pledge combination booked the partner's Pledge, a wrong move and a slot a fifth move then lacked), #141 (a Zoroark's
 * moves book on the body it disguises as), and one finding without an issue (a gen 2 log whose four species share the nickname "???"). Any other gap is a red row and a finding.
 */

/** The feedback fixtures' pinned Smogon data, as `forced-reconstruction-support.ts` reads it (the same files and key scheme). */
const pinnedFetcher = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const key = join('test', 'e2e-feedback', 'fixtures', 'smogon', path.replace(/[^a-z0-9.]+/gi, '_'));
  if (!existsSync(`${key}.json`)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${key}.json`, 'utf-8')) } as unknown as Response;
}) as typeof fetch;
const noData = (async () => ({ ok: false, status: 404, json: async () => { throw new Error('404'); } }) as unknown as Response) as typeof fetch;

type Path = 'bare' | 'bank' | 'nodata';
const PATHS: Path[] = ['bare', 'bank', 'nodata'];
const FAMILY = (formatid: string) => /championsvgc/.test(formatid) ? 'Champions VGC' : /champions/.test(formatid) ? 'Champions OU'
  : /vgc/.test(formatid) ? 'VGC SV' : /doubles/.test(formatid) ? 'Doubles OU' : 'singles';
const TYPE = (formatid: string) => /vgc/.test(formatid) ? 'vgc' : /doubles/.test(formatid) ? 'doubles' : 'singles';

type Replay = ReplayData & { formatid?: string };
interface Found { game: string; family: string; type: string; path: Path; gap: Gap & { owner: ReturnType<typeof ownerOf> } }
const found: Found[] = [];
const totals = { games: 0, bodies: 0, moves: 0, held: 0 };

/** The teams one build path makes for a replay. */
async function teamsOf(replay: Replay, id: string, path: Path, fetcher: typeof fetch): Promise<{ p1Team: PokemonSet[]; p2Team: PokemonSet[] }> {
  const parsed = parseReplayLogWithObservations(replay.log);
  const formatId = replay.formatid ?? id;
  const built = await bankTeamsFor({ log: replay.log, formatId, parsed, fetcher: path === 'bare' ? undefined : path === 'nodata' ? noData : fetcher });
  if (!built.teams) throw new Error(`${id} (${path}): no teams (${built.reason})`);
  return built.teams;
}

/** One game on the three paths: no body without a set, no gap without an owner; the owned gaps go to the owners' rows. */
async function sweepGame(id: string, file: string, fetcher: typeof fetch) {
  const replay = JSON.parse(readFileSync(file, 'utf-8')) as Replay;
  const formatid = replay.formatid ?? id;
  const unowned: string[] = [];
  for (const path of PATHS) {
    const check = checkBuiltSets(replay.log, await teamsOf(replay, id, path, fetcher));
    if (path === 'bank') Object.assign(totals, { games: totals.games + 1, bodies: totals.bodies + check.bodies, moves: totals.moves + check.moves, held: totals.held + check.held });
    for (const body of check.unmatched) unowned.push(`${path}: no set for ${body}`);
    for (const gap of check.gaps) {
      const owner = ownerOf(gap);
      found.push({ game: id, family: FAMILY(formatid), type: TYPE(formatid), path, gap: { ...gap, owner } });
      if (!owner) unowned.push(`${path}: ${gap.side} ${gap.species} lacks ${gap.move} (${gap.via.join(', ')})`);
    }
  }
  expect(unowned, `${id}: logged moves the built sets lack, with no issue that owns them`).toEqual([]);
}

const corpusFile = (id: string) => join('.fit-corpus', `${id}.json`);
const hasCorpus = existsSync('.fit-corpus');
const fixtureFile = (id: string) => join('test', 'e2e-feedback', 'fixtures', `${id}.json`);
const corpusIds = [...games.core, ...(process.env.LOGGED_MOVE_SWEEP === 'full' ? games.full : [])];
/** The games by family and game type, the titles' groups (the format id sits in the replay, else in the game's id). */
const byFamily = (ids: string[], file: (id: string) => string) => {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const formatid = (JSON.parse(readFileSync(file(id), 'utf-8')) as Replay).formatid ?? id;
    const key = `${FAMILY(formatid)} (${TYPE(formatid)})`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return groups;
};
const corpusPlayed = hasCorpus ? corpusIds.filter(id => existsSync(corpusFile(id))) : [];

describe('the oracle reads the log', () => {
  const log = [
    '|gen|9', '|switch|p1a: Ditto|Ditto|100/100', '|switch|p2a: Dragonite|Dragonite, M|100/100', '|switch|p2b: Primarina|Primarina, F|100/100',
    '|move|p2a: Dragonite|Extreme Speed|p1a: Ditto', '|-transform|p1a: Ditto|p2a: Dragonite', '|move|p1a: Ditto|Outrage|p2a: Dragonite',
    '|move|p1a: Ditto|Outrage|p2a: Dragonite|[from]lockedmove', '|move|p2a: Dragonite|Struggle|p1a: Ditto',
    '|move|p2b: Primarina|Water Pledge|p1a: Ditto|[from] move: Grass Pledge', '|move|p2b: Primarina|Moonblast|p1a: Ditto|[from]Magic Coat',
    '|move|p2b: Primarina|Surf|p1a: Ditto|[from] move: Sleep Talk', '|move|p2b: Primarina|Dazzling Gleam|p1a: Ditto|[from]ability: Dancer',
    '|cant|p2b: Primarina|Disable|Hyper Voice',
  ].join('\n');
  const bodies = loggedBodies(log);
  const movesOf = (key: string) => [...(bodies.get(key)?.moves.keys() ?? [])];

  test('a transformed body books to the body it copied, and Struggle, lockedmove, Magic Coat and an ability books nothing', () => {
    expect(movesOf('p2|Dragonite')).toEqual(['Extreme Speed', 'Outrage']);
    expect(bodies.get('p2|Dragonite')?.moves.get('Outrage')).toEqual(new Set(['transform']));
    expect(movesOf('p1|Ditto')).toEqual([]);
  });
  test('a Pledge combination books the shown move, Sleep Talk the shown move, a cant line the move it names', () => {
    expect(movesOf('p2|Primarina')).toEqual(['Water Pledge', 'Surf', 'Hyper Voice']);
    expect(bodies.get('p2|Primarina')?.moves.get('Water Pledge')).toEqual(new Set(['from-move']));
  });
  test('a blocker\'s cant line books nothing (the move is the foe\'s), and bodies that share a nickname stay apart', () => {
    const more = loggedBodies([
      '|gen|9', '|switch|p1a: Farigiraf|Farigiraf, M|100/100', '|switch|p2a: ???|Snorlax, M|100/100', '|move|p2a: ???|Fake Out|p1a: Farigiraf',
      '|cant|p1a: Farigiraf|ability: Armor Tail|Fake Out|[of] p2a: ???', '|switch|p2a: ???|Gengar, M|100/100', '|move|p2a: ???|Shadow Ball|p1a: Farigiraf',
      '|switch|p2a: ???|Snorlax, M|100/100', '|move|p2a: ???|Body Slam|p1a: Farigiraf',
    ].join('\n'));
    expect([...more.get('p1|Farigiraf')!.moves.keys()]).toEqual([]);
    expect([...more.get('p2|???|snorlax')!.moves.keys()]).toEqual(['Fake Out', 'Body Slam']);
    expect([...more.get('p2|???|gengar')!.moves.keys()]).toEqual(['Shadow Ball']);
  });
  test('a built set that lacks a logged move is a gap; Hidden Power answers by its slot', () => {
    const set = (species: string, moves: string[]) => ({ name: species, species, moves }) as PokemonSet;
    const team = { p1Team: [set('Ditto', ['Transform'])], p2Team: [set('Dragonite', ['Extreme Speed', 'Hidden Power Fire']), set('Primarina', ['Water Pledge', 'Surf'])] };
    const check = checkBuiltSets(log, team);
    expect(check.gaps.map(gap => `${gap.species}:${gap.move}`).sort()).toEqual(['Dragonite:Outrage', 'Primarina:Hyper Voice']);
    expect(ownerOf(check.gaps.find(gap => gap.species === 'Dragonite')!)).toBe('#139');
    expect(checkBuiltSets('|gen|7\n|switch|p1a: A|Zoroark|100/100\n|move|p1a: A|Hidden Power|p2a: B', { p1Team: [set('Zoroark', ['Hidden Power Ice'])], p2Team: [] }).gaps).toEqual([]);
  });
});

describe('the crowned formes swap Iron Head for their own move when the battle starts (the simulator, not our code)', () => {
  const slotsAfterStart = (species: string, item: string): string[] => {
    const team = [{ name: species, species, item, ability: 'Intrepid Sword', moves: ['Iron Head', 'Protect'], evs: {}, ivs: {}, nature: 'Adamant', gender: '' }];
    const battle = new Battle({ formatid: 'gen9customgame' as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(team as PokemonSet[]) }, p2: { name: 'B', team: Teams.pack(team as PokemonSet[]) } });
    if (battle.sides[0].requestState === 'teampreview') { battle.choose('p1', 'default'); battle.choose('p2', 'default'); }
    return battle.sides[0].pokemon[0].moveSlots.map(slot => slot.move);
  };
  test.each([['Zacian', 'Rusted Sword', 'Behemoth Blade'], ['Zamazenta', 'Rusted Shield', 'Behemoth Bash']])('%s with %s plays %s in the slot of Iron Head', (species, item, move) => {
    expect(slotsAfterStart(species, item)).toEqual([move, 'Protect']);
  });
  test('a logged Behemoth move books as the body\'s own, and a set that kept Iron Head is a gap of nobody\'s owner', () => {
    const log = '|gen|9\n|switch|p1a: Zacian|Zacian-Crowned|100/100\n|move|p1a: Zacian|Behemoth Blade|p2a: B';
    const set = (moves: string[]) => ({ p1Team: [{ name: 'Zacian', species: 'Zacian-Crowned', moves } as PokemonSet], p2Team: [] });
    expect(checkBuiltSets(log, set(['Behemoth Blade'])).gaps).toEqual([]);
    expect(checkBuiltSets(log, set(['Iron Head'])).gaps.map(ownerOf)).toEqual([null]);
  });
});

describe('the feedback fixtures hold every logged move on every build path', () => {
  for (const [group, ids] of byFamily(FIXTURES.map(fixture => fixture.id), fixtureFile)) {
    describe(group, () => {
      for (const id of ids) test(id, () => sweepGame(id, fixtureFile(id), pinnedFetcher), 600_000);
    });
  }
});

describe.skipIf(!hasCorpus)('the corpus games hold every logged move on every build path', () => {
  const rows = hasCorpus ? byFamily(corpusPlayed, corpusFile) : new Map<string, string[]>();
  for (const [group, ids] of rows) {
    describe(group, () => {
      for (const id of ids) test(id, () => sweepGame(id, corpusFile(id), diskCachedSmogonFetcher()), 600_000);
    });
  }
});

/** The gaps of one owner over the games swept above (the rows run after them in file order). */
const gapsOf = (owner: string) => found.filter(row => row.gap.owner === owner).map(row => `${row.type} ${row.family} ${row.game} (${row.path}): ${row.gap.side} ${row.gap.species} lacks ${row.gap.move}`);

describe.skipIf(!hasCorpus)('the gaps with an owner (expected failures until the owner is fixed)', () => {
  // Round 89 (#140) fixed its gaps: its games are a plain row now (a Pledge combination books the shown move, with no extra slot).
  test('#140: no gap is left of a Pledge combination that books the partner\'s Pledge', () => expect(gapsOf('#140')).toEqual([]));
  test.fails('#139: a transformed body\'s moves book to the body it copied', () => expect(gapsOf('#139')).toEqual([]));
  test.fails('finding, no issue yet: bodies that share a nickname (smogtours-gen2ou-349774, "???" for four species) book to one body', () => expect(gapsOf('shared-nickname')).toEqual([]));
  test.fails('#141: a Zoroark\'s moves book on the Zoroark (milestone 1.3.0)', () => expect(gapsOf('#141')).toEqual([]));
  test('the sweep counted its games and moves', () => {
    expect(totals.games).toBe(FIXTURES.length + corpusPlayed.length);
    expect(totals.held).toBeLessThanOrEqual(totals.moves);
  });
});
