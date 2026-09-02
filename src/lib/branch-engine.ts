import { BattleStreams, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';
import type { ChoiceLockContext } from './choice-lock';
import { serializeBattleStable, trialAdvanceLog } from './eval/forward-model';
import {
  ALIGNMENT_SEEDS, chooseAlignedSeed, extractProtocolEvents, scoreAlignment,
  type SeedChoice, type TurnAlignmentRecord,
} from './hax-alignment';
import type { BranchChoiceErrorLog, BranchRuntime, PokemonIdent, SimBattle } from './branch/types';
import { reorderForLeads, trimTeamToBring } from './branch/team-order';
import { collectForcedSwitchSpecies, extractLeads, getMainChoice, parseTurnBlocks } from './branch/protocol-choices';
import {
  buildForcedSwitchChoice, correctActivesFromProtocol, correctBattleFromSnapshot, hasForceSwitch,
  hasStaleForcedSwitchRequest, refreshRequestsFromLiveState, repairStaleForcedSwitchRequest,
} from './branch/corrections';
import { replaceLogWithReplayPrefix, syncLogActivesFromBattle } from './branch/log-sync';
import { safeStreamWrite, sleep } from './branch/execute';

export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
} from './branch/types';
export { correctActivesFromProtocol } from './branch/corrections';
export {
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
} from './branch/state';
export { annotateNicknames, executeBranchChoices, resolveSideChoices } from './branch/execute';
export type { ResolvedSideCommand } from './branch/execute';

// @pkmn/sim's random-format rulesets reference Node's `global` object (e.g.
// `global.Config?.potd` in rulesets), which doesn't exist in browsers and made
// every Random Battle branch die with an uncaught ReferenceError (B2).
if (typeof (globalThis as Record<string, unknown>).global === 'undefined') {
  (globalThis as Record<string, unknown>).global = globalThis;
}

export async function reconstructBranchRuntime(params: {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  snapshot?: TurnSnapshot | null;
  /** Real replay player names — sim sides and the winner line use them (G10). */
  playerNames?: [string, string];
  onLogLines?: (lines: string[]) => void;
  /** Reports replay progress while rebuilding towards the target turn (B17). */
  onProgress?: (turn: number, targetTurn: number) => void;
  /** Aborts the turn-replay loop early (Cancel button, B17). */
  abort?: AbortSignal;
  /** Overall replay deadline; a wedged reconstruction stops instead of hanging. */
  deadlineMs?: number;
  /**
   * Single-pass position capture (eval sweeps): at every turn boundary
   * before targetTurn the battle is snapshot-corrected and handed out, so
   * one reconstruction yields the whole game instead of one per turn.
   */
  capturePositions?: {
    snapshotFor(turn: number): TurnSnapshot | null;
    onPosition(turn: number, battle: SimBattle): void;
  };
  /**
   * Raw boundary hand-out (the calibration harness's single-pass path):
   * fired at the START of every block iteration — the exact spot where a
   * per-target reconstruction with targetTurn ≤ this block's turn exits
   * its loop — and hands out the UNCORRECTED live battle. The caller
   * clones and applies applyTargetCorrections itself, so the hand-out can
   * never change the ongoing replay: it stays byte-identical to what any
   * per-target run of the same replay plays.
   */
  onRawBoundary?: (blockTurn: number, battle: SimBattle) => void;
  /** Protocol-truth lock context (③): boundary corrections re-stamp from it. */
  choiceLocks?: ChoiceLockContext;
  /**
   * Turn-0 branching: start the game with THESE leads instead of the
   * replay's (species/names per side, slot order preserved — doubles sends
   * two; null or empty keeps the replay leads). Only meaningful with
   * targetTurn 1 and no snapshot corrections — a corrected boundary would
   * put the original leads right back on the field.
   */
  leadOverride?: { p1: string[] | null; p2: string[] | null };
  /**
   * Bring-limited formats (VGC's 4 of 6, BSS's 3 of 6): field ONLY these
   * species per side. The branch runs on a bring-all base format, which
   * would otherwise bench never-brought Pokémon for the engine — and every
   * evaluation and play-out on the live battle — to switch into. Fail-open:
   * a list that does not match the team exactly leaves the team whole.
   */
  bringOnly?: { p1: string[]; p2: string[] } | null;
}): Promise<BranchRuntime> {
  const { format, p1Team, p2Team, replayLog, targetTurn, snapshot, onLogLines, onProgress, abort, capturePositions } = params;
  const overallDeadline = Date.now() + (params.deadlineMs ?? 60_000);
  let timedOut = false;
  const { p1Leads, p2Leads } = extractLeads(replayLog);
  const leadsFor = (replayLeads: PokemonIdent[], override: string[] | null | undefined): PokemonIdent[] =>
    override && override.length > 0 ? override.map(name => ({ name, species: name })) : replayLeads;
  const orderedP1 = trimTeamToBring(reorderForLeads(p1Team, leadsFor(p1Leads, params.leadOverride?.p1)), params.bringOnly?.p1);
  const orderedP2 = trimTeamToBring(reorderForLeads(p2Team, leadsFor(p2Leads, params.leadOverride?.p2)), params.bringOnly?.p2);

  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const collectedLog: string[] = [];
  const choiceErrors: BranchChoiceErrorLog = { count: 0, last: null };
  const haxAlignment: TurnAlignmentRecord[] = [];

  // A sim crash (old-gen mods throw on odd states) rejects these detached
  // stream pumps — record it as a choice error so the turn-sync guard reacts
  // instead of the rejection escaping as an unhandled promise.
  const recordStreamError = (error: unknown) => {
    choiceErrors.count += 1;
    choiceErrors.last = error instanceof Error ? error.message : String(error);
  };

  void (async () => {
    try {
      for await (const chunk of streams.omniscient) {
        const lines = chunk.split('\n').filter(line => line.trim());
        collectedLog.push(...lines);
        onLogLines?.(lines);
      }
    } catch (error) {
      recordStreamError(error);
    }
  })();

  for (const sideStream of [streams.p1, streams.p2]) {
    void (async () => {
      try {
        for await (const chunk of sideStream) {
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('|error|')) continue;
            choiceErrors.count += 1;
            choiceErrors.last = line
              .slice('|error|'.length)
              .replace(/^\[(?:Invalid|Unavailable) choice\]\s*/, '');
          }
        }
      } catch (error) {
        recordStreamError(error);
      }
    })();
  }

  const p1Packed = Teams.pack(orderedP1);
  const p2Packed = Teams.pack(orderedP2);

  const waitForBattle = async (
    predicate: (battle: SimBattle) => boolean,
    timeoutMs = 1500,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const battle = battleStream.battle;
      if (battle && predicate(battle)) return;
      await sleep(10);
    }
  };

  const waitForLog = async (
    predicate: (log: string[]) => boolean,
    timeoutMs = 1000,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate(collectedLog)) return;
      await sleep(10);
    }
  };

  const waitForLogIdle = async (idleMs = 50, timeoutMs = 500) => {
    const startedAt = Date.now();
    let lastLength = collectedLog.length;
    let stableSince = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(10);
      if (collectedLog.length !== lastLength) {
        lastLength = collectedLog.length;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= idleMs) {
        return;
      }
    }
  };

  // A sim crash inside a write must surface as a choice error so the
  // turn-sync guard skips or stops instead of taking the process down.
  const writeSim = (payload: string) => safeStreamWrite(streams.omniscient, payload, recordStreamError);

  // A rejected replay choice (a team edit can remove the very move the
  // protocol used) must not abandon the turn half-chosen: the sim keeps the
  // other side's accepted choice pending, and the next write would commit the
  // turn with that stale choice — the branch then plays the user's choices one
  // commit late and a leftover switch fails with "A switch failed because the
  // Pokémon trying to switch in is already in." (gen9draft-2058494320 turn 4).
  // Answering the rejected sides with `default` commits the turn and keeps the
  // replay in lockstep; the snapshot corrections repair the aftermath.
  const commitRejectedChoicesWithDefaults = async (turnBeforeChoice: number) => {
    const battle = battleStream.battle;
    if (!battle || battle.ended || battle.turn > turnBeforeChoice) return;
    const pendingSides = battle.sides.filter(side => side.requestState && !side.isChoiceDone());
    if (pendingSides.length === 0) return;
    const retryErrors = choiceErrors.count;
    writeSim(pendingSides.map(side => `>${side.id} default`).join('\n'));
    await waitForBattle(currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      hasForceSwitch(currentBattle, 0) ||
      hasForceSwitch(currentBattle, 1) ||
      choiceErrors.count > retryErrors,
    );
  };

  // Turn-sync guard: choices must land on the turn that produced them. Once a
  // block fails to commit its turn, every later block would feed the sim
  // choices from the wrong turn — the HP corrections mask the drift while
  // structural state diverges (the GPL replay lost a pending Future Sight and
  // opened turn 25 with the wrong active, five blocks ahead of the sim).
  // Feed defaults until the sim stands at `wantedTurn`; a false return means
  // the battle is wedged and replaying further blocks would corrupt it.
  const advanceSimToTurn = async (wantedTurn: number): Promise<boolean> => {
    for (let attempts = 0; attempts < 12; attempts++) {
      const battle = battleStream.battle;
      if (!battle || battle.ended) return false;
      if (battle.turn >= wantedTurn) return true;
      if (abort?.aborted || Date.now() > overallDeadline) return false;

      const turnBefore = battle.turn;
      const pendingSides = battle.sides.filter(side => side.requestState && !side.isChoiceDone());
      if (pendingSides.length === 0) {
        // No open request — give in-flight writes a beat to surface one.
        await waitForBattle(current =>
          current.ended ||
          current.turn > turnBefore ||
          current.sides.some(side => side.requestState && !side.isChoiceDone()),
        250);
        const current = battleStream.battle;
        if (!current) return false;
        if (current.turn === turnBefore && !current.sides.some(side => side.requestState && !side.isChoiceDone())) {
          return false;
        }
        continue;
      }

      const errorsBefore = choiceErrors.count;
      writeSim(pendingSides.map(side => `>${side.id} default`).join('\n'));
      await waitForBattle(current =>
        current.ended ||
        current.turn > turnBefore ||
        choiceErrors.count > errorsBefore,
      );
      if (battleStream.battle?.turn === turnBefore && choiceErrors.count > errorsBefore) return false;
    }
    return (battleStream.battle?.turn ?? 0) >= wantedTurn;
  };

  const p1Name = JSON.stringify(params.playerNames?.[0]?.trim() || 'Player 1');
  const p2Name = JSON.stringify(params.playerNames?.[1]?.trim() || 'Player 2');
  // FIXED seed: an unseeded battle rerolls damage/secondary outcomes every
  // reconstruction, so the same replay+turn yielded DIFFERENT positions run
  // to run (diverged fallback paths, shuffled bench slots, wrong choice
  // locks) — the sweep's cached eval and the branch a click executes in
  // could disagree about what "switch 3" even is (draft T48).
  writeSim(
    `>start {"formatid":"${format}","seed":"1,2,3,4"}\n>player p1 {"name":${p1Name},"team":"${p1Packed}"}\n>player p2 {"name":${p2Name},"team":"${p2Packed}"}`
  );
  await waitForBattle(battle => !!battle.sides[0] && !!battle.sides[1], 1000);

  const setupBattle = battleStream.battle;
  const teamPreviewCommands: string[] = [];
  if (setupBattle?.sides[0]?.requestState === 'teampreview') {
    teamPreviewCommands.push('>p1 default');
  }
  if (setupBattle?.sides[1]?.requestState === 'teampreview') {
    teamPreviewCommands.push('>p2 default');
  }

  if (teamPreviewCommands.length > 0) {
    writeSim(teamPreviewCommands.join('\n'));
  }
  await waitForBattle(
    battle =>
      battle.ended ||
      battle.turn > 0 ||
      battle.sides[0]?.requestState === 'move' ||
      battle.sides[1]?.requestState === 'move',
    1000,
  );

  const { turns } = parseTurnBlocks(replayLog);

  for (const turnBlock of turns) {
    if (params.onRawBoundary && battleStream.battle) {
      params.onRawBoundary(turnBlock.turn, battleStream.battle);
    }
    if (turnBlock.turn >= targetTurn) break;
    if (abort?.aborted) break;
    if (Date.now() > overallDeadline) {
      timedOut = true;
      break;
    }

    const battle = battleStream.battle;
    if (!battle || battle.ended) break;
    onProgress?.(turnBlock.turn, targetTurn);

    // Re-align before writing: a sim that ran ahead skips stale blocks, a sim
    // that fell behind advances on defaults first. Either way this block's
    // choices only ever reach the sim standing at this block's turn.
    if (battle.turn > turnBlock.turn) continue;
    if (battle.turn < turnBlock.turn) {
      if (!(await advanceSimToTurn(turnBlock.turn))) break;
      if (battle.turn !== turnBlock.turn) continue;
    }

    // Boundary capture: the battle sits at the start of turnBlock.turn —
    // exactly the position a per-turn reconstruction of this turn returns.
    // Corrections keep the ongoing replay in lockstep with the protocol.
    if (capturePositions && battle.turn === turnBlock.turn) {
      const turnSnapshot = capturePositions.snapshotFor(turnBlock.turn);
      if (turnSnapshot) correctBattleFromSnapshot(battle, turnSnapshot);
      repairStaleForcedSwitchRequest(battle);
      capturePositions.onPosition(turnBlock.turn, battle);
    }

    const turnBeforeChoice = battle.turn;

    const p1Choice = getMainChoice(turnBlock.preUpkeep, 'p1', battle);
    const p2Choice = getMainChoice(turnBlock.preUpkeep, 'p2', battle);

    // HAX ALIGNMENT: pick the candidate seed whose rolls reproduce this
    // block's protocol events (crits/misses/secondaries/faints — spec
    // 2026-08-15-hax-alignment-design.md), then reseed the live battle
    // before committing. Reseeding happens EVERY turn (also for candidate
    // 0) so one turn's RNG consumption never shifts the next turn's rolls.
    const blockLines = [...turnBlock.preUpkeep, ...turnBlock.postUpkeep];
    const expectedEvents = extractProtocolEvents(blockLines);
    const alignForced = {
      p1: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1'),
      p2: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2'),
    };
    let seedChoice: SeedChoice = {
      seed: ALIGNMENT_SEEDS[0], trialScore: null, trialPerfect: false,
      candidatesTried: 0, trialsFailed: 0,
    };
    try {
      const checkpoint = serializeBattleStable(battle);
      seedChoice = chooseAlignedSeed({
        expected: expectedEvents,
        trial: seed => {
          try {
            return trialAdvanceLog(
              { serialized: checkpoint }, p1Choice, p2Choice, seed,
              { p1: [...alignForced.p1], p2: [...alignForced.p2] },
            );
          } catch {
            return null;
          }
        },
        shouldStop: () => abort?.aborted === true || Date.now() > overallDeadline,
      });
    } catch {
      // Serialization failure on an odd state: run the block exactly as today.
    }
    battle.resetRNG(seedChoice.seed);
    const simLogStart = battle.log.length;

    // Waking up on choice rejections keeps wedged turns from burning the full
    // wait timeout on every retry (B17 — 30-60s "Preparing branch…" hangs).
    const mainChoiceErrors = choiceErrors.count;
    writeSim(`>p1 ${p1Choice}\n>p2 ${p2Choice}`);
    await waitForBattle(currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      hasForceSwitch(currentBattle, 0) ||
      hasForceSwitch(currentBattle, 1) ||
      choiceErrors.count > mainChoiceErrors,
    );

    if (choiceErrors.count > mainChoiceErrors) {
      const battleAfterChoice = battleStream.battle;
      if (battleAfterChoice && !hasForceSwitch(battleAfterChoice, 0) && !hasForceSwitch(battleAfterChoice, 1)) {
        await commitRejectedChoicesWithDefaults(turnBeforeChoice);
      }
    }

    const p1Forced = alignForced.p1;
    const p2Forced = alignForced.p2;
    const p1ForceIndex = { current: 0 };
    const p2ForceIndex = { current: 0 };

    let maxIterations = 10;
    while (maxIterations-- > 0) {
      const currentBattle = battleStream.battle;
      if (!currentBattle || currentBattle.ended) break;

      const p1Needs = hasForceSwitch(currentBattle, 0);
      const p2Needs = hasForceSwitch(currentBattle, 1);
      if (!p1Needs && !p2Needs) break;

      const commands: string[] = [];
      const p1ForcedChoice = buildForcedSwitchChoice(currentBattle, 0, p1Forced, p1ForceIndex);
      const p2ForcedChoice = buildForcedSwitchChoice(currentBattle, 1, p2Forced, p2ForceIndex);
      if (p1ForcedChoice) commands.push(`>p1 ${p1ForcedChoice}`);
      if (p2ForcedChoice) commands.push(`>p2 ${p2ForcedChoice}`);

      if (commands.length === 0) break;
      const forcedChoiceErrors = choiceErrors.count;
      writeSim(commands.join('\n'));
      await waitForBattle(currentBattle =>
        currentBattle.ended ||
        currentBattle.turn > turnBeforeChoice ||
        (!hasForceSwitch(currentBattle, 0) && !hasForceSwitch(currentBattle, 1)) ||
        choiceErrors.count > forcedChoiceErrors,
      );
      if (choiceErrors.count > forcedChoiceErrors) {
        await commitRejectedChoicesWithDefaults(turnBeforeChoice);
        break;
      }
    }

    const latestBattle = battleStream.battle;
    if (latestBattle) {
      // After this block's events the board sits at the START of the next
      // turn — that boundary's trail is the lock truth for the position.
      correctActivesFromProtocol(latestBattle, [
        ...turnBlock.preUpkeep,
        ...turnBlock.postUpkeep,
      ], params.choiceLocks ? { context: params.choiceLocks, turn: turnBlock.turn + 1 } : undefined);
      // Score the TRULY emitted block (battle.log is synchronous — the
      // async collectedLog pump may still lag) against the protocol.
      haxAlignment.push({
        turn: turnBlock.turn,
        seed: seedChoice.seed,
        trialPerfect: seedChoice.trialPerfect,
        trialsFailed: seedChoice.trialsFailed,
        candidatesTried: seedChoice.candidatesTried,
        actual: scoreAlignment(
          expectedEvents,
          extractProtocolEvents(latestBattle.log.slice(simLogStart)),
        ),
      });
    }
  }

  await waitForBattle(
    battle => battle.ended || !!battle.requestState || !!battle.sides[0].activeRequest || !!battle.sides[1].activeRequest,
    500,
  );
  await waitForLog(
    log => log.some(line => line === `|turn|${targetTurn}`) || !!battleStream.battle?.ended,
    1000,
  );
  await waitForLogIdle();

  if (snapshot && battleStream.battle) {
    correctBattleFromSnapshot(battleStream.battle, snapshot);
    replaceLogWithReplayPrefix(collectedLog, replayLog, targetTurn);
  }

  if (battleStream.battle) {
    refreshRequestsFromLiveState(battleStream.battle);
    const correctionLines = syncLogActivesFromBattle(collectedLog, battleStream.battle, targetTurn);
    if (correctionLines.length > 0) onLogLines?.(correctionLines);
  }

  return {
    battleStream,
    streams,
    log: collectedLog,
    choiceErrors,
    timedOut,
    haxAlignment,
  };
}

/**
 * The end-of-reconstruction correction chain a per-target run applies to
 * its final battle — for a caller-owned battle (the clone-and-correct
 * single-pass path, see onRawBoundary). Mirrors the tail of
 * reconstructBranchRuntime exactly: snapshot correction when a snapshot
 * exists, then the request refresh, in that order.
 */
export function applyTargetCorrections(battle: SimBattle, snapshot: TurnSnapshot | null | undefined): void {
  if (snapshot) correctBattleFromSnapshot(battle, snapshot);
  refreshRequestsFromLiveState(battle);
}

/**
 * Post-reconstruction sanity check (B7): detects wedged states — no pending
 * request on a live battle, or a forced switch that has no eligible switch-in —
 * so the UI can offer a way out instead of silently dead-ending.
 */
/**
 * Did this reconstruction actually ARRIVE at `turn` as a live position?
 * `validateBranchRuntime` deliberately accepts an ended battle (branching
 * into a finished line is a legal, explained state), so callers that use
 * the final battle AS a specific turn's position need this stricter test:
 *
 * - short of the turn  → the replay wedged on the way there;
 * - `ended`            → always an artifact for a sampled turn, because a
 *   sampled turn lies BEFORE the real game's end; an ended arrival means
 *   the diverging choice replay killed a side the real game kept (the
 *   premature-end cascade, gen9draft-2058494320 from turn 56 unhealed).
 *   The calibration harness applies the same invariant when scoring.
 *
 * Without it the eval sweep stored a prematurely-ended battle as the LAST
 * turn's position, and the graph showed a single phantom ±1.00 point at
 * the far right with every other turn a gap (2026-08-12 report).
 */
export function reconstructionReached(runtime: BranchRuntime, turn: number): boolean {
  if (runtime.timedOut) return false;
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) return false;
  return battle.turn >= turn;
}

export function validateBranchRuntime(runtime: BranchRuntime): string | null {
  if (runtime.timedOut) {
    return 'Reconstruction timed out before reaching this turn. Try branching from a nearby turn.';
  }

  const battle = runtime.battleStream.battle;
  if (!battle) return 'The simulator could not start this battle.';
  if (battle.ended) return null;

  if (!battle.requestState) {
    return 'The simulator got stuck while rebuilding this turn. Try branching from a nearby turn.';
  }

  if (hasStaleForcedSwitchRequest(battle)) {
    return 'The simulator demands a switch that no longer matches the battle state: the reconstruction diverged at this turn. Try a nearby turn.';
  }

  for (const side of battle.sides) {
    const needsSwitch = side.activeRequest?.forceSwitch?.some(Boolean);
    if (!needsSwitch) continue;
    const hasBench = side.pokemon.some(pokemon => !pokemon.isActive && !pokemon.fainted);
    if (!hasBench) {
      return `${side.name} must switch but has no healthy Pokémon left to send in: the reconstruction diverged at this turn. Try a nearby turn.`;
    }
  }

  return null;
}

