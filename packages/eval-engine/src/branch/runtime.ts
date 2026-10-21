import { extractProtocolEvents, scoreAlignment } from '../hax-alignment.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import type { BranchRuntime, SimBattle, TurnBlock } from './types.ts';
import { getMainChoice, parseTurnBlocks } from './protocol-choices.ts';
import { faintedSlots, logGoesOn, shownBodyIds, type ProtocolBench } from './team-order.ts';
import { alignArrivalDice, alignBlockSeed, type AlignedBlock } from './arrival-dice.ts';
import {
  buildForcedSwitchChoice, correctActivesFromProtocol, correctBattleFromSnapshot, hasForceSwitch,
  refreshRequestsFromLiveState, repairStaleForcedSwitchRequest,
} from './corrections.ts';
import { replaceLogWithReplayPrefix, syncLogActivesFromBattle } from './log-sync.ts';
import {
  advanceSimToTurn, commitRejectedChoicesWithDefaults, openSession, orderTeams, startBattle, stopRequested,
  waitForBattle, waitForLog, waitForLogIdle,
  type ReconstructionSession, type ReconstructParams,
} from './runtime-session.ts';

export type { ReconstructParams } from './runtime-session.ts';

/**
 * Boundary capture: the battle sits at the start of turnBlock.turn —
 * exactly the position a per-turn reconstruction of this turn returns.
 * Corrections keep the ongoing replay in lockstep with the protocol.
 */
function captureBoundary(session: ReconstructionSession, battle: SimBattle, turn: number) {
  const { capturePositions } = session.params;
  if (capturePositions && battle.turn === turn) {
    const turnSnapshot = capturePositions.snapshotFor(turn);
    if (turnSnapshot) correctBattleFromSnapshot(battle, turnSnapshot);
    repairStaleForcedSwitchRequest(battle);
    capturePositions.onPosition(turn, battle);
  }
}

/**
 * HAX ALIGNMENT: pick the candidate seed whose rolls reproduce this
 * block's protocol events (crits/misses/secondaries/faints — spec
 * 2026-08-15-hax-alignment-design.md), then reseed the live battle
 * before committing. Reseeding happens EVERY turn (also for candidate
 * 0) so one turn's RNG consumption never shifts the next turn's rolls.
 * The events are keyed by name; the built sets carry the replay's names
 * (round 72, T238), so the block meets the sim's as it is.
 */
function chooseBlockSeed(
  session: ReconstructionSession, battle: SimBattle, turnBlock: TurnBlock, p1Choice: string, p2Choice: string,
): AlignedBlock {
  return alignBlockSeed(battle, turnBlock, p1Choice, p2Choice, () => stopRequested(session));
}

/**
 * Waking up on choice rejections keeps wedged turns from burning the full
 * wait timeout on every retry (B17 — 30-60s "Preparing branch…" hangs).
 */
async function commitMainChoices(session: ReconstructionSession, turnBeforeChoice: number, p1Choice: string, p2Choice: string) {
  const { battleStream, choiceErrors } = session;
  const mainChoiceErrors = choiceErrors.count;
  session.writeSim(`>p1 ${p1Choice}\n>p2 ${p2Choice}`);
  await waitForBattle(session, currentBattle =>
    currentBattle.ended ||
    currentBattle.turn > turnBeforeChoice ||
    hasForceSwitch(currentBattle, 0) ||
    hasForceSwitch(currentBattle, 1) ||
    choiceErrors.count > mainChoiceErrors,
  );

  if (choiceErrors.count > mainChoiceErrors) {
    const battleAfterChoice = battleStream.battle;
    if (battleAfterChoice && !hasForceSwitch(battleAfterChoice, 0) && !hasForceSwitch(battleAfterChoice, 1)) {
      await commitRejectedChoicesWithDefaults(session, turnBeforeChoice);
    }
  }
}

/** Answers the sim's forced replacements with the protocol's switch-ins, in order. */
async function resolveForcedSwitches(
  session: ReconstructionSession, turnBeforeChoice: number, alignForced: AlignedBlock['alignForced'], blockLines: readonly string[],
) {
  const { battleStream, choiceErrors } = session;
  const p1Forced = alignForced.p1;
  const p2Forced = alignForced.p2;
  const p1ForceIndex = { current: 0 };
  const p2ForceIndex = { current: 0 };
  // What the protocol says about each side's bench (T250): read once, and only when a forced switch needs it.
  const benchCache: Partial<Record<'p1' | 'p2', ProtocolBench>> = {};
  const protocolBench = (side: 'p1' | 'p2') =>
    (benchCache[side] ??= {
      shown: shownBodyIds(session.params.replayLog, side), fainted: faintedSlots(blockLines, side),
      goesOn: logGoesOn(session.params.replayLog, turnBeforeChoice),
    });

  let maxIterations = 10;
  while (maxIterations-- > 0) {
    const currentBattle = battleStream.battle;
    if (!currentBattle || currentBattle.ended) break;

    const p1Needs = hasForceSwitch(currentBattle, 0);
    const p2Needs = hasForceSwitch(currentBattle, 1);
    if (!p1Needs && !p2Needs) break;

    const commands: string[] = [];
    const p1ForcedChoice = buildForcedSwitchChoice(currentBattle, 0, p1Forced, p1ForceIndex, protocolBench('p1'));
    const p2ForcedChoice = buildForcedSwitchChoice(currentBattle, 1, p2Forced, p2ForceIndex, protocolBench('p2'));
    if (p1ForcedChoice) commands.push(`>p1 ${p1ForcedChoice}`);
    if (p2ForcedChoice) commands.push(`>p2 ${p2ForcedChoice}`);

    if (commands.length === 0) break;
    const forcedChoiceErrors = choiceErrors.count;
    session.writeSim(commands.join('\n'));
    await waitForBattle(session, currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      (!hasForceSwitch(currentBattle, 0) && !hasForceSwitch(currentBattle, 1)) ||
      choiceErrors.count > forcedChoiceErrors,
    );
    if (choiceErrors.count > forcedChoiceErrors) {
      await commitRejectedChoicesWithDefaults(session, turnBeforeChoice);
      break;
    }
  }
}

/**
 * After this block's events the board sits at the START of the next
 * turn — that boundary's trail is the lock truth for the position. Then
 * score the TRULY emitted block (battle.log is synchronous — the async
 * collectedLog pump may still lag) against the protocol.
 */
function scoreBlock(session: ReconstructionSession, turnBlock: TurnBlock, aligned: AlignedBlock, simLogStart: number) {
  const latestBattle = session.battleStream.battle;
  if (!latestBattle) return;
  const { choiceLocks } = session.params;
  correctActivesFromProtocol(latestBattle, [
    ...turnBlock.preUpkeep,
    ...turnBlock.postUpkeep,
  ], choiceLocks ? { context: choiceLocks, turn: turnBlock.turn + 1 } : undefined);
  session.haxAlignment.push({
    turn: turnBlock.turn,
    seed: aligned.seedChoice.seed,
    trialPerfect: aligned.seedChoice.trialPerfect,
    trialsFailed: aligned.seedChoice.trialsFailed,
    candidatesTried: aligned.seedChoice.candidatesTried,
    actual: scoreAlignment(
      aligned.expectedEvents,
      extractProtocolEvents(latestBattle.log.slice(simLogStart)),
    ),
  });
}

/**
 * One turn block of the replay: re-align the sim to the block's turn, hand
 * out the boundary, choose the aligned seed, commit the protocol's choices,
 * resolve forced switches, and score the block. 'break' ends the replay.
 */
async function replayBlock(session: ReconstructionSession, turnBlock: TurnBlock): Promise<'continue' | 'break'> {
  const { params, battleStream } = session;
  if (params.onRawBoundary && battleStream.battle) {
    params.onRawBoundary(turnBlock.turn, battleStream.battle);
  }
  if (turnBlock.turn >= params.targetTurn) return 'break';
  if (params.abort?.aborted) return 'break';
  if (Date.now() > session.overallDeadline) {
    session.timedOut = true;
    return 'break';
  }

  const battle = battleStream.battle;
  if (!battle || battle.ended) return 'break';
  params.onProgress?.(turnBlock.turn, params.targetTurn);

  // Re-align before writing: a sim that ran ahead skips stale blocks, a sim
  // that fell behind advances on defaults first. Either way this block's
  // choices only ever reach the sim standing at this block's turn.
  if (battle.turn > turnBlock.turn) return 'continue';
  if (battle.turn < turnBlock.turn) {
    if (!(await advanceSimToTurn(session, turnBlock.turn))) return 'break';
    if (battle.turn !== turnBlock.turn) return 'continue';
  }

  captureBoundary(session, battle, turnBlock.turn);

  const turnBeforeChoice = battle.turn;

  const p1Choice = getMainChoice(turnBlock.preUpkeep, 'p1', battle);
  const p2Choice = getMainChoice(turnBlock.preUpkeep, 'p2', battle);

  const aligned = chooseBlockSeed(session, battle, turnBlock, p1Choice, p2Choice);
  battle.resetRNG(aligned.seedChoice.seed);
  const simLogStart = battle.log.length;

  await commitMainChoices(session, turnBeforeChoice, p1Choice, p2Choice);
  await resolveForcedSwitches(session, turnBeforeChoice, aligned.alignForced, [...turnBlock.preUpkeep, ...turnBlock.postUpkeep]);
  scoreBlock(session, turnBlock, aligned, simLogStart);
  return 'continue';
}

/** The trailing waits, the target-turn corrections, and the runtime hand-over. */
async function finishReconstruction(session: ReconstructionSession): Promise<BranchRuntime> {
  const { params, battleStream, collectedLog } = session;
  const { snapshot, replayLog, targetTurn, onLogLines } = params;
  await waitForBattle(
    session,
    battle => battle.ended || !!battle.requestState || !!battle.sides[0].activeRequest || !!battle.sides[1].activeRequest,
    500,
  );
  await waitForLog(
    session,
    log => log.some(line => line === `|turn|${targetTurn}`) || !!battleStream.battle?.ended,
    1000,
  );
  await waitForLogIdle(session);

  if (snapshot && battleStream.battle) {
    correctBattleFromSnapshot(battleStream.battle, snapshot);
    replaceLogWithReplayPrefix(collectedLog, replayLog, targetTurn);
  }

  if (battleStream.battle) {
    refreshRequestsFromLiveState(battleStream.battle);
    // Round 70: the arrival at a replay turn plays that turn under the seed the log's block has (a lead game has no snapshot).
    if (snapshot && !session.timedOut) alignArrivalDice(battleStream.battle, replayLog, targetTurn, () => stopRequested(session));
    const correctionLines = syncLogActivesFromBattle(collectedLog, battleStream.battle, targetTurn);
    if (correctionLines.length > 0) onLogLines?.(correctionLines);
  }

  return {
    battleStream,
    streams: session.streams,
    log: collectedLog,
    choiceErrors: session.choiceErrors,
    timedOut: session.timedOut,
    haxAlignment: session.haxAlignment,
  };
}

/**
 * Rebuilds the battle up to `targetTurn` by replaying the protocol's
 * choices block by block, then corrects the arrival position from the
 * snapshot. The stages run in the order the original single function had.
 */
export async function reconstructBranchRuntime(rawParams: ReconstructParams): Promise<BranchRuntime> {
  // The log's line endings are settled here once; every reader below sees LF (T206 for the engine).
  const params = { ...rawParams, replayLog: normalizeLineEndings(rawParams.replayLog) };
  const overallDeadline = Date.now() + (params.deadlineMs ?? 60_000);
  const { orderedP1, orderedP2 } = orderTeams(params);
  const session = openSession(params, overallDeadline);
  await startBattle(session, orderedP1, orderedP2);

  const { turns } = parseTurnBlocks(params.replayLog);
  for (const turnBlock of turns) {
    if ((await replayBlock(session, turnBlock)) === 'break') break;
  }

  return finishReconstruction(session);
}
