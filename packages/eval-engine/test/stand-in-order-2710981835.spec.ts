import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf, FixedDice } from '../src/sim-ask/copy';
import { actionPriority } from '../src/sim-ask/action-order';



/**
 * Round 89 (#108): Champions VGC 2710981835 turn 7. Floette-Mega (speed 169) opens with Dazzling Gleam and knocks Dragonite-Mega (speed
 * 147) out before it acts; Empoleon's Flash Cannon follows. The reporter saw the grading take Extreme Speed (+2) + Flash Cannon as the
 * played pair, which the log rules out. The rebuild is not the source of that row: the never-acted stand-in of Dragonite takes the
 * enabled move that stands last in the simulator's queue (T325, round 89 #111: `actionPriority`, no cut at 0), so Dragon Pulse (priority 0)
 * stands behind Floette's Dazzling Gleam and the block the simulator emits for the turn is the log's. The grading row (`played-match.ts`)
 * is not part of this spec.
 *
 * The replay is a fixture copy (`fixtures/gen9championsvgc2026regmc-2710981835.json`), rebuilt with the teams the log alone gives: Dragonite
 * knows Dragon Pulse and Thunderbolt there. The second row gives it the four moves of the report (Extreme Speed first, Protect last), so a
 * first-move or first-above-zero rule would pick a move that stands ahead of Floette.
 */
const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmc-2710981835.json', import.meta.url), 'utf-8')) as ReplayData;
const MOVE_LINES = /^\|(move|faint|cant|win)\|/;
const REPORTED_SET = ['extremespeed', 'dragonpulse', 'thunderbolt', 'protect'];

interface Scene { battle: SimBattle; preUpkeep: string[]; logged: string[] }

/** The battle at the start of turn 7 as the app rebuilds it, with the teams the log gives; `dragonite` replaces the moves of the p1 Dragonite. */
async function sceneOf(dragonite?: string[]): Promise<Scene> {
  await loadSimMods(getBranchSimulatorFormat(replay));
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  if (dragonite) {
    const body = p1Team.find(set => set.species.startsWith('Dragonite'));
    if (!body) throw new Error('no Dragonite on the p1 team');
    body.moves = dragonite;
  }
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: 7, snapshot: snapshots[6] ?? null,
    playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    deadlineMs: 120_000,
  });
  const block = parseTurnBlocks(replay.log).turns.find(turn => turn.turn === 7)!;
  return {
    battle: runtime.battleStream.battle as unknown as SimBattle, preUpkeep: block.preUpkeep,
    logged: [...block.preUpkeep, ...block.postUpkeep].filter(line => MOVE_LINES.test(line)),
  };
}

describe.each([
  ['the teams the log gives', undefined],
  ['the moves of the report (Extreme Speed first)', REPORTED_SET],
] as [string, string[] | undefined][])('turn 7 with %s', (_name, moves) => {
  let scene: Scene;
  beforeAll(async () => { scene = await sceneOf(moves); }, 240_000);

  const standIn = (): { id: string; choice: string } => {
    const choice = getMainChoice(scene.preUpkeep, 'p1', scene.battle);
    const slot = Number(/^move (\d+)/.exec(choice)![1]);
    return { id: scene.battle.sides[0].active[0]!.getMoveRequestData().moves[slot - 1].id, choice };
  };

  test('the position is turn 7 with Dragonite-Mega behind Floette-Mega', () => {
    const [dragonite, floette] = [scene.battle.sides[0].active[0]!, scene.battle.sides[1].active[0]!];
    expect([scene.battle.turn, dragonite.species.name, floette.species.name]).toEqual([7, 'Dragonite-Mega', 'Floette-Mega']);
    expect(dragonite.getActionSpeed()).toBeLessThan(floette.getActionSpeed());
  });

  test('the stand-in of Dragonite stands at priority 0 or below: no Extreme Speed (+2), no Protect (+4)', () => {
    const { id } = standIn();
    expect(['extremespeed', 'protect']).not.toContain(id);
    const dragonite = scene.battle.sides[0].active[0]!;
    for (const chance of [false, true]) expect(actionPriority(scene.battle, dragonite, id, chance)).toBeLessThanOrEqual(0);
  });

  // The simulator's damage roll is not the log's, so Dragonite may survive Dazzling Gleam in the emitted block (it then moves, behind
  // Floette); what the stand-in decides is the order of the move lines: nothing opens the turn but Floette, and the log's moves that the simulator also shows keep the log's order (a high roll can knock Empoleon out as well).
  test.each([false, true])('the turn the simulator emits (dice answer %s) opens with Floette and keeps the log\'s order of moves', chance => {
    const copy = copyOf(scene.battle);
    copy.prng = new FixedDice({ chance });
    const start = copy.log.length;
    copy.makeChoices(getMainChoice(scene.preUpkeep, 'p1', scene.battle), getMainChoice(scene.preUpkeep, 'p2', scene.battle));
    const key = (line: string): string => line.split('|').slice(1, 4).join('|');
    const moves = (lines: string[]): string[] => lines.filter(line => line.startsWith('|move|')).map(key);
    const emitted = moves(copy.log.slice(start));
    const logged = moves(scene.logged);
    expect(logged).toEqual(['move|p2a: Floette|Dazzling Gleam', 'move|p1b: Empoleon|Flash Cannon']);
    expect(emitted[0]).toBe(logged[0]);
    const shared = emitted.filter(move => logged.includes(move));
    expect(shared).toEqual(logged.slice(0, shared.length));
  });
});

describe('the contrast: the moves the grading offered for Dragonite', () => {
  test('Extreme Speed (+2) and Protect (+4) open the turn ahead of Floette, so the log rules them out', async () => {
    const scene = await sceneOf(REPORTED_SET);
    const clicks = { extremespeed: 'move 1 +1, move 1 +1', protect: 'move 4, move 1 +1' };
    for (const [id, click] of Object.entries(clicks)) {
      const copy = copyOf(scene.battle);
      copy.prng = new FixedDice({ chance: false });
      const start = copy.log.length;
      copy.makeChoices(click, getMainChoice(scene.preUpkeep, 'p2', scene.battle));
      const first = copy.log.slice(start).find(line => line.startsWith('|move|'))!;
      expect([id, first.split('|')[2]]).toEqual([id, 'p1a: Dragonite']);
    }
  }, 240_000);
});
