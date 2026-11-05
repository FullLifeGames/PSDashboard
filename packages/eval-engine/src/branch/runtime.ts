import { extractProtocolEvents, scoreAlignment } from '../hax-alignment.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import type { BranchRuntime, SimBattle, TurnBlock } from './types.ts';
import { getMainChoice, parseTurnBlocks } from './protocol-choices.ts';
import { faintedSlots } from './team-order.ts';
import { faintStep, forcedTurnDiceOrNull, protocolBenchOf, writeBlockPart } from '../dice/logged-block.ts';
import type { ForcedDie } from '../dice/types.ts';
import { alignArrivalDice, alignBlockSeed, forcedBlock, type AlignedBlock } from './arrival-dice.ts';
import {
  buildForcedSwitchChoice, correctActivesFromProtocol, correctBattleFromSnapshot, forceSwitches, hasForceSwitch,
  refreshRequestsFromLiveState, repairStaleForcedSwitchRequest,
} from './corrections.ts';
import { replaceLogWithReplayPrefix, syncLogActivesFromBattle } from './log-sync.ts';
import {
  advanceSimToTurn, commitRejectedChoicesWithDefaults, openSession, orderTeams, startBattle, stopRequested,
  waitForBattle, waitForLog, waitForLogIdle,
  type ReconstructionSession, type ReconstructParams, type ReplacementPoint,
} from './runtime-session.ts';

export type { ReconstructParams, ReplacementPoint } from './runtime-session.ts';

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
 * Round 86 (the log's dice, T306): one part of a block (the choices of both sides, or the answers to a forced replacement) goes to the sim
 * through the dice module when the block has dice to force, plain otherwise. False: the module could not play it and nothing reached the
 * live battle (`writeBlockPart`).
 */
function writePart(
  session: ReconstructionSession, battle: SimBattle, dice: readonly ForcedDie[] | null, commands: { side: 'p1' | 'p2'; command: string }[],
): boolean {
  const write = () => session.writeSim(commands.map(({ side, command }) => `>${side} ${command}`).join('\n'));
  if (!dice) {
    write();
    return true;
  }
  return writeBlockPart({ live: battle, dice, commands, write });
}

/**
 * Waking up on choice rejections keeps wedged turns from burning the full
 * wait timeout on every retry (B17 — 30-60s "Preparing branch…" hangs).
 * False: the dice module could not play the choices and nothing was written.
 */
async function commitMainChoices(
  session: ReconstructionSession, turnBeforeChoice: number, p1Choice: string, p2Choice: string, dice: readonly ForcedDie[] | null = null,
): Promise<boolean> {
  const { battleStream, choiceErrors } = session;
  const mainChoiceErrors = choiceErrors.count;
  const commands = [{ side: 'p1' as const, command: p1Choice }, { side: 'p2' as const, command: p2Choice }];
  if (!battleStream.battle || !writePart(session, battleStream.battle, dice, commands)) return false;
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
  return true;
}

/**
 * Round 79 (T290): the open request as a replacement point. Null where it is no knockout (a pivot's or an ejected body's request
 * is its own half-turn: it neither counts nor fires); 'gap' where it is one and the protocol does not agree with the simulator:
 * a forced slot whose body fainted outside this block, or that the log sends no one into. A gap counts as a request (the ordinal
 * stays the protocol's) and fires nothing, never a guessed point.
 */
function replacementPoint(
  battle: SimBattle, turn: number, ordinal: number, blockLines: readonly string[],
  forced: Record<'p1' | 'p2', string[]>, cursors: Record<'p1' | 'p2', number>,
): ReplacementPoint | 'gap' | null {
  const slots: ReplacementPoint['forced'] = { p1: [], p2: [] };
  const played: ReplacementPoint['played'] = { p1: [], p2: [] };
  let knockout = false;
  let agrees = true;
  for (const [index, side] of (['p1', 'p2'] as const).entries()) {
    const fainted = faintedSlots(blockLines, side);
    for (const [slot, needed] of forceSwitches(battle, index).entries()) {
      if (!needed) continue;
      const isKnockout = !!battle.sides[index].active[slot]?.fainted && fainted.has(slot);
      knockout ||= isKnockout;
      const species = forced[side][cursors[side] + slots[side].length];
      if (!isKnockout || !species) agrees = false;
      slots[side].push(slot);
      played[side].push(species ?? '');
    }
  }
  if (!knockout) return null;
  return agrees ? { turn, ordinal, forced: slots, played } : 'gap';
}

/** Hands an open knockout request to the capture hook; true where the request counts as a point of the block (a gap counts too). */
function offerReplacement(
  session: ReconstructionSession, battle: SimBattle, turn: number, ordinal: number, blockLines: readonly string[],
  forced: Record<'p1' | 'p2', string[]>, cursors: Record<'p1' | 'p2', number>,
): boolean {
  const onReplacement = session.params.capturePositions?.onReplacement;
  if (!onReplacement) return false;
  const point = replacementPoint(battle, turn, ordinal, blockLines, forced, cursors);
  if (point && point !== 'gap') {
    try {
      onReplacement(point, battle);
    } catch {
      // A failing consumer leaves a gap, never a failed replay.
    }
  }
  return !!point;
}

/** Answers the sim's forced replacements with the protocol's switch-ins, in order. */
async function resolveForcedSwitches(
  session: ReconstructionSession, turnBeforeChoice: number, alignForced: AlignedBlock['alignForced'], blockLines: readonly string[],
  dice: readonly ForcedDie[] | null = null,
) {
  const { battleStream, choiceErrors } = session;
  const p1Forced = alignForced.p1;
  const p2Forced = alignForced.p2;
  const p1ForceIndex = { current: 0 };
  const p2ForceIndex = { current: 0 };
  // What the protocol says about each side's bench (T250): read once, and only when a forced switch needs it.
  const protocolBench = protocolBenchOf(session.params.replayLog, blockLines, turnBeforeChoice);

  let forcedDice = dice;
  let maxIterations = 10;
  let ordinal = 0;
  while (maxIterations-- > 0) {
    const currentBattle = battleStream.battle;
    if (!currentBattle || currentBattle.ended) break;

    const p1Needs = hasForceSwitch(currentBattle, 0);
    const p2Needs = hasForceSwitch(currentBattle, 1);
    if (!p1Needs && !p2Needs) break;

    // The request is open and nothing answered it yet: the capture reads the battle as the player faced it.
    const forcedAnswers = { p1: p1Forced, p2: p2Forced };
    const cursors = { p1: p1ForceIndex.current, p2: p2ForceIndex.current };
    if (offerReplacement(session, currentBattle, turnBeforeChoice, ordinal, blockLines, forcedAnswers, cursors)) ordinal++;

    const commands: { side: 'p1' | 'p2'; command: string }[] = [];
    const p1ForcedChoice = buildForcedSwitchChoice(currentBattle, 0, p1Forced, p1ForceIndex, protocolBench('p1'));
    const p2ForcedChoice = buildForcedSwitchChoice(currentBattle, 1, p2Forced, p2ForceIndex, protocolBench('p2'));
    if (p1ForcedChoice) commands.push({ side: 'p1', command: p1ForcedChoice });
    if (p2ForcedChoice) commands.push({ side: 'p2', command: p2ForcedChoice });

    if (commands.length === 0) break;
    const forcedChoiceErrors = choiceErrors.count;
    // a part the dice module cannot play goes in plain, and so does the rest of the block
    if (!writePart(session, currentBattle, forcedDice, commands)) {
      forcedDice = null;
      writePart(session, currentBattle, null, commands);
    }
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
  ], choiceLocks ? { context: choiceLocks, turn: turnBlock.turn + 1 } : undefined, turnBlock.preUpkeep.length);
  session.haxAlignment.push({
    turn: turnBlock.turn,
    seed: aligned.seedChoice.seed,
    via: aligned.via,
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
 * Round 86 (the log's dice, T306): the block plays under the hidden dice of seed index 0 with the log's dice forced; a block the dice module
 * cannot play (a choice the copy refuses, a state the reader cannot name the clicks of) falls back to the sixteen-seed search. The forced
 * replacements that follow play through the module too, part by part.
 */
async function playBlock(
  session: ReconstructionSession, battle: SimBattle, turnBlock: TurnBlock, p1Choice: string, p2Choice: string,
): Promise<{ aligned: AlignedBlock; simLogStart: number }> {
  const turnBeforeChoice = battle.turn;
  const lines = [...turnBlock.preUpkeep, ...turnBlock.postUpkeep];
  let aligned = forcedBlock(battle, turnBlock);
  battle.resetRNG(aligned.seedChoice.seed);
  let simLogStart = battle.log.length;
  const choices = { p1: p1Choice, p2: p2Choice };
  const logged = forcedTurnDiceOrNull(battle, lines, choices);
  // Round 86 (the faint step, T306): the damage roll of the hits that decide a faint or a die the log shows; null sends the block to the seed search
  const dice = logged && faintStep({
    battle, expected: aligned.expectedEvents, seed: aligned.seedChoice.seed, choices, forced: aligned.alignForced,
    bench: protocolBenchOf(session.params.replayLog, lines, turnBeforeChoice),
  }, logged).dice;
  if (!dice || !(await commitMainChoices(session, turnBeforeChoice, p1Choice, p2Choice, dice))) {
    aligned = chooseBlockSeed(session, battle, turnBlock, p1Choice, p2Choice);
    battle.resetRNG(aligned.seedChoice.seed);
    simLogStart = battle.log.length;
    await commitMainChoices(session, turnBeforeChoice, p1Choice, p2Choice);
  }
  await resolveForcedSwitches(session, turnBeforeChoice, aligned.alignForced, lines, aligned.via === 'forced' ? dice : null);
  return { aligned, simLogStart };
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

  const p1Choice = getMainChoice(turnBlock.preUpkeep, 'p1', battle);
  const p2Choice = getMainChoice(turnBlock.preUpkeep, 'p2', battle);

  const { aligned, simLogStart } = await playBlock(session, battle, turnBlock, p1Choice, p2Choice);
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
