import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
  type ReplayData, type TurnSnapshot,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { wasShownBody, shownIdsOfSnapshot } from '../src/branch/team-order';
import type { SimBattle } from '../src/branch/types';
import { deserializeBattleExact } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';

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
