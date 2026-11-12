import { beforeAll, describe, expect, test } from 'vitest';
import { Battle, Dex, TeamValidator, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  CHAMPIONS_MOD, getBranchSimulatorFormat, getReplayBringCount, getReplayGameType, logRules,
} from '@fulllifegames/replay-core';
import { checkGameTeams, loadSimMods, startGameLog } from '../src/index';
import { SWEEPS_FULL } from './dice-fixtures';
import { legalTeams, playableFormatIds } from './new-game-teams';

/**
 * Round 89 (lane H, #105): a new game starts from two teams in the format the user picks. The sweep plays every format the
 * simulator lists for a user's own team (singles or doubles, no generated team) after the Champions mod loads: each one starts
 * from two legal teams, and what the app needs of the start reads from the simulator's own battle (the header log, the game
 * type, the team preview, the picked team size, the level the format gives). A plain run plays the families the app measures
 * plus every sixth format; `DICE_SWEEPS=full` plays all of them. The simulator is the oracle throughout (AGENTS.md).
 */

const FAMILIES = [
  'gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9customgame', 'gen9doublescustomgame', 'gen9bssregi', 'gen9championsou',
  'gen9championsvgc2026regmc', 'gen9championsdoubles', 'gen9championscustomgame', 'gen8ou', 'gen4ou', 'gen2ou', 'gen1ou', 'gen3ou',
  'gen7doublesou', 'gen9monotype', 'gen9balancedhackmons',
];

let formatIds: string[] = [];
beforeAll(async () => {
  await loadSimMods('gen9championsou');
  const all = playableFormatIds();
  formatIds = SWEEPS_FULL ? all : all.filter((id, index) => FAMILIES.includes(id) || index % 6 === 0);
}, 60_000);

const NAMES: [string, string] = ['Player 1', 'Player 2'];

/** The team as the simulator's validator leaves it (the server plays this copy): it sets each level the format gives. */
function validated(formatId: string, team: PokemonSet[]): PokemonSet[] {
  const copy = JSON.parse(JSON.stringify(team)) as PokemonSet[];
  expect(TeamValidator.get(formatId).validateTeam(copy)).toBeNull();
  return copy;
}

function bringProblems(id: string, start: Awaited<ReturnType<typeof startGameLog>>): string[] {
  const picked = Dex.formats.getRuleTable(Dex.formats.get(id)).pickedTeamSize || null;
  return [
    start.bringCount === (start.teamPreview ? picked : null) ? '' : `bring ${start.bringCount}`,
    getReplayBringCount({ id: 'newgame-test', log: start.header.join('\n'), formatid: id }) === picked ? '' : 'replay bring count',
  ];
}

/** What reads wrong in one format's start, against the simulator's own rule table and validator. */
function headerProblems(id: string, teams: { p1: PokemonSet[]; p2: PokemonSet[] }, start: Awaited<ReturnType<typeof startGameLog>>, problems: { p1: string[]; p2: string[] }): string[] {
  const format = Dex.formats.get(id);
  const rules = Dex.formats.getRuleTable(format);
  const log = start.header.join('\n');
  const levels = validated(id, teams.p1).map(set => set.level);
  return [
    problems.p1.length === 0 && problems.p2.length === 0 ? '' : `check: ${[...problems.p1, ...problems.p2].slice(0, 2).join(' / ')}`,
    start.format === id ? '' : `format ${start.format}`,
    start.gameType === format.gameType ? '' : `game type ${start.gameType}`,
    getReplayGameType(log) === format.gameType ? '' : `header game type ${getReplayGameType(log)}`,
    logRules(log).gen === Dex.forFormat(format).gen ? '' : `rules gen ${logRules(log).gen}`,
    start.teamPreview === rules.has('teampreview') ? '' : `team preview ${start.teamPreview}`,
    start.header.some(line => line.startsWith('|teampreview')) === start.teamPreview ? '' : 'header teampreview line',
    start.header.some(line => line.startsWith('|start') || line.startsWith('|t:|') || line.startsWith('|switch|')) ? 'header past the start' : '',
    ...bringProblems(id, start),
    start.bodies.p1.length === teams.p1.length && start.bodies.p2.length === teams.p2.length ? '' : 'body count',
    start.bodies.p1.every((body, index) => body.level === levels[index] && start.teams.p1[index].level === body.level) ? '' : `level ${start.bodies.p1[0]?.level}`,
    start.activeCount === (format.gameType === 'doubles' ? 2 : 1) ? '' : `active ${start.activeCount}`,
  ].filter(Boolean);
}

async function startOf(formatId: string) {
  const teams = legalTeams(formatId);
  if ('problems' in teams) throw new Error(`${formatId}: no legal team found (${teams.problems.slice(0, 2).join(' / ')})`);
  const start = await startGameLog({ format: formatId, p1Team: teams.p1, p2Team: teams.p2, playerNames: NAMES });
  return { teams, start };
}

describe('a game starts from two legal teams in every playable format', () => {
  test('the sweep lists the playable formats of the registry (178 after the Champions mod)', () => {
    expect(playableFormatIds()).toHaveLength(178);
    expect(playableFormatIds()).toEqual(expect.arrayContaining(['gen9ou', 'gen9championsou', 'gen9championsvgc2026regmc', 'gen9championscustomgame']));
  });

  test('every format of the sweep: legal teams pass the check, the battle starts, the header reads as the format says', async () => {
    const failures: string[] = [];
    for (const id of formatIds) {
      try {
        const { teams, start } = await startOf(id);
        const problems = await checkGameTeams(id, teams);
        const row = headerProblems(id, teams, start, problems);
        if (row.length) failures.push(`${id}: ${row.join('; ')}`);
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);

  test('the branch format plays every body as the chosen format does (level, stats, ability, item)', async () => {
    const failures: string[] = [];
    for (const id of formatIds) {
      try {
        const { teams, start } = await startOf(id);
        const branchFormat = getBranchSimulatorFormat({ id: 'newgame-test', log: start.header.join('\n'), formatid: id });
        await loadSimMods(branchFormat);
        const chosen = new Battle({ formatid: id as never, seed: [1, 2, 3, 4], p1: { name: 'a', team: Teams.pack(validated(id, teams.p1)) }, p2: { name: 'b', team: Teams.pack(validated(id, teams.p2)) } });
        const branch = new Battle({ formatid: branchFormat as never, seed: [1, 2, 3, 4], p1: { name: 'a', team: Teams.pack(start.teams.p1) }, p2: { name: 'b', team: Teams.pack(start.teams.p2) } });
        const read = (battle: Battle) => battle.sides.flatMap(side => side.pokemon.map(pokemon => JSON.stringify({
          species: pokemon.species.id, level: pokemon.level, stats: pokemon.storedStats, maxhp: pokemon.maxhp, // The validator names Gen 1 and 2's missing ability 'No Ability'; a battle without it reads ''.
          ability: pokemon.baseAbility === 'noability' ? '' : pokemon.baseAbility, item: pokemon.item,
        })));
        const differing = read(chosen).findIndex((row, index) => row !== read(branch)[index]);
        if (differing >= 0) failures.push(`${id} (branch ${branchFormat}): body ${differing}\n  ${read(chosen)[differing]}\n  ${read(branch)[differing]}`);
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);
});

describe('scenes of the report', () => {
  const garchomp = (extra: Partial<PokemonSet> = {}): PokemonSet => ({
    name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Jolly', gender: '',
    evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, ...extra,
  });

  test('a VGC paste without a Level line plays at level 50, in the VGC format and in the branch format', async () => {
    const teams = legalTeams('gen9vgc2025regi');
    if ('problems' in teams) throw new Error('no legal VGC team');
    const unleveled = (team: PokemonSet[]) => team.map(set => ({ ...set, level: undefined as unknown as number }));
    const start = await startGameLog({ format: 'gen9vgc2025regi', p1Team: unleveled(teams.p1), p2Team: unleveled(teams.p2), playerNames: NAMES });
    expect(start.bodies.p1.every(body => body.level === 50)).toBe(true);
    expect(start.teams.p2.every(set => set.level === 50)).toBe(true);
    expect(start.bringCount).toBe(4);
    expect(start.gameType).toBe('doubles');
    const branchFormat = getBranchSimulatorFormat({ id: 'newgame-test', log: start.header.join('\n'), formatid: 'gen9vgc2025regi' });
    expect(branchFormat).toBe('gen9doublesou');
    const branch = new Battle({ formatid: branchFormat as never, p1: { name: 'a', team: Teams.pack(start.teams.p1) }, p2: { name: 'b', team: Teams.pack(start.teams.p2) } });
    expect(branch.sides[0].pokemon.map(pokemon => pokemon.level)).toEqual(Array(6).fill(50));
  });

  test('a format without a team preview (Gen 4) starts with every body a possible lead and no preview lines', async () => {
    const { teams, start } = await startOf('gen4ou');
    expect(start.teamPreview).toBe(false);
    expect(start.bringCount).toBeNull();
    expect(start.bodies.p1.map(body => body.species)).toEqual(teams.p1.map(set => Dex.species.get(set.species).name));
    expect(start.header.some(line => line.startsWith('|poke|'))).toBe(false);
  });

  test('a Champions format loads its mod itself and reads Stat Points as the mod does', async () => {
    const { start } = await startOf('gen9championsvgc2026regmc');
    expect(start.format).toBe('gen9championsvgc2026regmc');
    expect(start.teamPreview).toBe(true);
    expect(start.bodies.p1.every(body => body.level === 50)).toBe(true);
    expect(logRules(start.header.join('\n')).mod).toBe(CHAMPIONS_MOD);
  });

  test('checkGameTeams: an OU team with a banned species reports the simulator\'s own problem', async () => {
    const banned = Dex.species.all().find(species => species.tier === 'Uber' && species.gen === 9 && !species.isNonstandard);
    const team = [garchomp({ species: banned!.name, name: banned!.name, ability: banned!.abilities['0'], moves: ['Protect'] })];
    const direct = TeamValidator.get('gen9ou').validateTeam(JSON.parse(JSON.stringify(team)) as PokemonSet[]);
    expect(direct?.length).toBeGreaterThan(0);
    const problems = await checkGameTeams('gen9ou', { p1: team, p2: [garchomp()] });
    expect(problems.p1).toEqual(direct);
    expect(problems.p1.join(' ')).toContain(banned!.name);
    expect(problems.p2).toEqual([]);
  });

  test('checkGameTeams: a Custom Game plays each species\' own abilities, Hackmons formats play any', async () => {
    const levitate = garchomp({ ability: 'Levitate' });
    const custom = await checkGameTeams('gen9customgame', { p1: [levitate], p2: [garchomp()] });
    expect(custom.p1).toHaveLength(1);
    expect(custom.p1[0]).toContain('Garchomp');
    expect(custom.p1[0]).toContain('Levitate');
    expect(custom.p2).toEqual([]);
    expect(await checkGameTeams('gen9balancedhackmons', { p1: [levitate], p2: [garchomp()] })).toEqual({ p1: [], p2: [] });
    const doubles = await checkGameTeams('gen9doublescustomgame', { p1: [garchomp(), garchomp()], p2: [levitate, garchomp()] });
    expect(doubles.p1).toEqual([]);
    expect(doubles.p2).toHaveLength(1);
    const champions = await checkGameTeams('gen9championscustomgame', { p1: [levitate], p2: [garchomp({ ability: 'Sand Veil' })] });
    expect(champions.p1).toHaveLength(1);
    expect(champions.p2).toEqual([]);
  });

  test('checkGameTeams: every Custom Game of every generation accepts a species\' own abilities and refuses a foreign one', async () => {
    const customGames = playableFormatIds().filter(id => Dex.formats.get(id).debug && Dex.forFormat(Dex.formats.get(id)).gen >= 3);
    expect(customGames.length).toBeGreaterThanOrEqual(15);
    const failures: string[] = [];
    for (const id of customGames) {
      const dex = Dex.forFormat(Dex.formats.get(id));
      const species = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.isNonstandard).filter((_, index) => SWEEPS_FULL || index % 25 === 0);
      for (const entry of species) {
        const own = Object.values(entry.abilities).filter(Boolean);
        const foreign = dex.abilities.all().find(ability => ability.exists && !ability.isNonstandard && !own.includes(ability.name))!;
        const set = (ability: string) => garchomp({ species: entry.name, name: entry.name, ability, moves: ['Tackle'] });
        // Two bodies per side: a Doubles Custom Game asks for a team of two.
        const result = await checkGameTeams(id, { p1: own.flatMap(ability => [set(ability), set(own[0])]), p2: [set(foreign.name), set(own[0])] });
        if (result.p1.length !== 0) failures.push(`${id} ${entry.name}: own ability refused (${result.p1[0]})`);
        if (result.p2.length === 0) failures.push(`${id} ${entry.name}: ${foreign.name} accepted`);
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
