import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
  type ReplayData,
  type TurnSnapshot,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { wasShownBody, shownIdsOfSnapshot, reorderForLeads, sameBodyName, trimTeamToBring } from '../src/branch/team-order';
import type { SimBattle } from '../src/branch/types';
import { deserializeBattleExact } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { Battle, Teams } from '@pkmn/sim';
import { extractLeads, findPokemonOnSide } from '../src/branch/protocol-choices';
import { set } from './named-games-support';

/**
 * Round 88 (T327, #63): a body the log never shows stays on the field after a simulator-only faint. In VGC 2565721987 the simulator
 * knocks out Iron Bundle at turn 5 and Miraidon at turn 6, where the log leaves them at 1 and 23 hit points. The replacement round
 * sends Kyogre and Archaludon in, who never come out in the log, and the guard of `retireUnshownBench` refuses (the simulator forces a
 * slot the log did not faint). The boundary correction revives the two bodies from the snapshot, which moves Kyogre back to the bench,
 * and Archaludon stays on p1b. At turn 7 the log has one living body of p1 (Miraidon, with p1b empty after Iron Bundle's faint) and
 * the position had three.
 *
 * The replay is a fixture copy (`fixtures/gen9vgc2026regi-2565721987.json`, the log of the VGC holdout's game, ruling 8 of round 88),
 * rebuilt with the teams the log alone gives, as the engine package's other replay rows do: the scene reproduces without Smogon data.
 * The sweep over the abilities with an End handler is `unshown-body-sweep.spec.ts`.
 *
 * Round 89 (#116): the bring list names the Ditto's own species now, so the rebuild of 2565721987 fields the four bodies the log
 * shows and Kyogre and Archaludon no longer enter the battle: the scene above needs the six-body team, and this describe rebuilds
 * without `bringOnly` (the other describes keep the app's own reading).
 */

const replayOf = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

interface Rebuilt { positions: Map<number, SimBattle>; snapshots: TurnSnapshot[]; atTarget: SimBattle }

/** The positions of every turn up to `through` as the bank captures them, and the live battle of the app's rebuild to the same turn. */
async function rebuild(name: string, through: number, bringLimited = true): Promise<Rebuilt> {
  const replay = replayOf(name);
  await loadSimMods(getBranchSimulatorFormat(replay));
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const serialized = new Map<number, string>();
  // The bank captures the position of a turn when the replay reaches the next one: a capture through turn N targets turn N + 1.
  const run = (capture: boolean) => reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: capture ? through + 1 : through, snapshot: snapshotFor(capture ? through + 1 : through),
    playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    bringOnly: bringLimited ? replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined : undefined,
    deadlineMs: 120_000,
    capturePositions: capture ? { snapshotFor, onPosition: (turn, battle) => { serialized.set(turn, serializeLiveBattle(battle)); } } : undefined,
  });
  await run(true);
  const atTarget = await run(false);
  return {
    positions: new Map([...serialized].map(([turn, text]) => [turn, deserializeBattleExact(text) as unknown as SimBattle])),
    snapshots, atTarget: atTarget.battleStream.battle as unknown as SimBattle,
  };
}

const living = (battle: SimBattle, sideIdx: number) => battle.sides[sideIdx].pokemon.filter(body => !body.fainted && body.hp > 0).map(body => body.name);
const onField = (battle: SimBattle, sideIdx: number) => battle.sides[sideIdx].active.filter(body => body && !body.fainted).map(body => body.name);

/** The living bodies that stand on the field and that the snapshot's seen entries never name. */
function unshownOnField(battle: SimBattle, snapshot: TurnSnapshot): string[] {
  return [0, 1].flatMap(sideIdx => {
    const seen = (sideIdx === 0 ? snapshot.p1 : snapshot.p2).pokemon.filter(entry => entry.maxhp > 0);
    const shown = shownIdsOfSnapshot(battle, seen);
    return battle.sides[sideIdx].active.filter(body => body && !body.fainted && !wasShownBody(body, shown)).map(body => `p${sideIdx + 1}:${body.name}`);
  });
}

describe('VGC 2565721987 (Regulation I): the position holds the bodies the log has', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild('gen9vgc2026regi-2565721987', 7, false); }, 240_000);

  test('turn 7: one living body of p1, as the log has it (Miraidon; Iron Bundle fell at turn 6, p1b stays empty)', () => {
    const position = rebuilt.positions.get(7)!;
    expect(living(position, 0)).toEqual(['Miraidon']);
    expect(position.sides[0].pokemonLeft).toBe(1);
    expect(onField(position, 0)).toEqual(['Miraidon']);
    // The bodies that left are no fallen ally of the log: Grimmsnarl, Ditto and Iron Bundle fell, Kyogre and Archaludon never came out.
    expect(position.sides[0].totalFainted).toBe(3);
    expect(living(position, 1)).toEqual(['Calyrex']);
  });

  test('turn 7: the live battle of the app\'s rebuild to the same turn holds the same bodies', () => {
    expect(living(rebuilt.atTarget, 0)).toEqual(['Miraidon']);
    expect(rebuilt.atTarget.sides[0].pokemonLeft).toBe(1);
  });

  test('turn 6: the field of both sides holds the bodies the log has (Miraidon and Iron Bundle against Calyrex and Landorus)', () => {
    const position = rebuilt.positions.get(6)!;
    expect(onField(position, 0).sort()).toEqual(['Iron Bundle', 'Miraidon']);
    expect(onField(position, 1).sort()).toEqual(['Calyrex', 'Landorus']);
  });

  test.each([1, 2, 3, 4, 5, 6, 7])('turn %i: no living body the log never shows stands on the field', turn => {
    expect(unshownOnField(rebuilt.positions.get(turn)!, rebuilt.snapshots[turn - 1])).toEqual([]);
  });
});

/** The fixtures that play on without a stranger: the correction leaves them as they were (their rows hold whatever the unchanged code gave). */
describe.each([
  { name: 'gen9vgc2026regi-2630181744', label: 'VGC (Regulation I 2630181744)', through: 7 },
  { name: 'smogtours-gen9doublesou-912884', label: 'Doubles OU (912884)', through: 7 },
  { name: 'gen9championsvgc2026regmbbo3-2687970740', label: 'Champions VGC (2687970740)', through: 7 },
])('a game without a stranger: $label', ({ name, through }) => {
  test('no living body the log never shows stands on the field, and the shown ones are all there', async () => {
    const { positions, snapshots } = await rebuild(name, through);
    expect(positions.size).toBeGreaterThan(3);
    for (const [turn, position] of positions) {
      expect(unshownOnField(position, snapshots[Math.min(turn - 1, snapshots.length - 1)]), `turn ${turn}`).toEqual([]);
    }
  }, 240_000);
});

const japanese = [set('チョコクロワ', 'Indeedee-F'), set('うみのうた', 'Primarina'), set('ワスレイヌ', 'Houndstone'), set('グレンタウン', 'Armarouge')];
const lead = (name: string, species: string) => ({ name, species });

describe('sameBodyName', () => {
  test('equal names match, equal ids match, an empty id is no key', () => {
    expect(sameBodyName('Rias', 'Rias')).toBe(true);
    expect(sameBodyName('Rias!', 'Rias?')).toBe(true);
    expect(sameBodyName('うみのうた', 'うみのうた')).toBe(true);
    expect(sameBodyName('うみのうた', 'ワスレイヌ')).toBe(false);
    expect(sameBodyName('', '')).toBe(false);
    expect(sameBodyName('うみのうた', undefined)).toBe(false);
  });
});

describe('reorderForLeads', () => {
  test('names without an id: each lead finds its own body (doubles leads in slots three and four, singles one lead)', () => {
    const doubles = reorderForLeads(japanese, [lead('うみのうた', 'Primarina'), lead('グレンタウン', 'Armarouge')]);
    expect(doubles.map(pokemon => pokemon.name)).toEqual(['うみのうた', 'グレンタウン', 'チョコクロワ', 'ワスレイヌ']);
    const singles = reorderForLeads(japanese, [lead('ワスレイヌ', 'Houndstone')]);
    expect(singles.map(pokemon => pokemon.name)).toEqual(['ワスレイヌ', 'チョコクロワ', 'うみのうた', 'グレンタウン']);
  });

  test('two names of one id: the exact name decides', () => {
    const team = [set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax')];
    expect(reorderForLeads(team, [lead('Rias?', 'Snorlax')]).map(pokemon => pokemon.name)).toEqual(['Rias?', 'Rias!']);
  });

  test('one name on two bodies: the species of the lead decides', () => {
    const team = [set('Twin', 'Dragapult'), set('Twin', 'Snorlax')];
    expect(reorderForLeads(team, [lead('Twin', 'Snorlax')]).map(pokemon => pokemon.species)).toEqual(['Snorlax', 'Dragapult']);
  });

  test('a lead named by its species finds the body that carries no nickname', () => {
    const team = [set('うみのうた', 'Primarina'), set('Snorlax', 'Snorlax')];
    expect(reorderForLeads(team, [lead('Snorlax', 'Snorlax')]).map(pokemon => pokemon.species)).toEqual(['Snorlax', 'Primarina']);
  });
});

describe('trimTeamToBring', () => {
  test('names without an id: the brought names keep their own bodies', () => {
    const kept = trimTeamToBring(japanese, ['グレンタウン', 'うみのうた', 'ワスレイヌ'], { gen: 9, mod: undefined });
    expect(kept.map(pokemon => pokemon.name)).toEqual(['うみのうた', 'ワスレイヌ', 'グレンタウン']);
  });

  test('two names of one id: each brought name keeps its exact body', () => {
    const team = [set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax'), set('Plain', 'Clefable')];
    expect(trimTeamToBring(team, ['Rias?', 'Plain'], { gen: 9, mod: undefined }).map(pokemon => pokemon.name)).toEqual(['Rias?', 'Plain']);
  });
});

describe('extractLeads', () => {
  test('two leads of one species under different names without an id stay two leads', () => {
    const log = ['|switch|p1a: ピカ|Pikachu, L50, F|100/100', '|switch|p1b: チュウ|Pikachu, L50, F|100/100', '|turn|1'].join('\n');
    expect(extractLeads(log).p1Leads).toEqual([lead('ピカ', 'Pikachu'), lead('チュウ', 'Pikachu')]);
  });
});

describe('findPokemonOnSide', () => {
  const battle = new Battle({
    formatid: 'gen9doublescustomgame' as never, seed: [1, 2, 3, 4],
    p1: { name: 'A', team: Teams.pack(japanese) }, p2: { name: 'B', team: Teams.pack([set('Plain', 'Snorlax'), set('Mouse', 'Pikachu')]) },
  });
  const side = battle.sides[0];

  test('a name without an id finds its own body, and a name no body has finds none', () => {
    expect(findPokemonOnSide(side, 'うみのうた')?.species.name).toBe('Primarina');
    expect(findPokemonOnSide(side, 'グレンタウン')?.species.name).toBe('Armarouge');
    expect(findPokemonOnSide(side, 'ぜんぜん')).toBeNull();
  });

  test('a species still finds its body', () => {
    expect(findPokemonOnSide(side, 'Houndstone')?.name).toBe('ワスレイヌ');
    expect(findPokemonOnSide(battle.sides[1], 'Snorlax')?.name).toBe('Plain');
  });
});
