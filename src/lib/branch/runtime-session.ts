import { BattleStreams, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../../types';
import type { ChoiceLockContext } from '../choice-lock';
import type { TurnAlignmentRecord } from '../hax-alignment';
import type { BranchChoiceErrorLog, PokemonIdent, SimBattle } from './types';
import { reorderForLeads, trimTeamToBring } from './team-order';
import { extractLeads } from './protocol-choices';
import { hasForceSwitch } from './corrections';
import { safeStreamWrite, sleep } from './execute';

export interface ReconstructParams {
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
}

/** Everything one reconstruction run shares between its stages. */
export interface ReconstructionSession {
  params: ReconstructParams;
  battleStream: BattleStreams.BattleStream;
  streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  collectedLog: string[];
  choiceErrors: BranchChoiceErrorLog;
  haxAlignment: TurnAlignmentRecord[];
  overallDeadline: number;
  timedOut: boolean;
  recordStreamError(error: unknown): void;
  writeSim(payload: string): void;
}

/** Leads first (the replay's or the override's), then the bring trim. */
export function orderTeams(params: ReconstructParams): { orderedP1: PokemonSet[]; orderedP2: PokemonSet[] } {
  const { p1Leads, p2Leads } = extractLeads(params.replayLog);
  const leadsFor = (replayLeads: PokemonIdent[], override: string[] | null | undefined): PokemonIdent[] =>
    override && override.length > 0 ? override.map(name => ({ name, species: name })) : replayLeads;
  const orderedP1 = trimTeamToBring(reorderForLeads(params.p1Team, leadsFor(p1Leads, params.leadOverride?.p1)), params.bringOnly?.p1);
  const orderedP2 = trimTeamToBring(reorderForLeads(params.p2Team, leadsFor(p2Leads, params.leadOverride?.p2)), params.bringOnly?.p2);
  return { orderedP1, orderedP2 };
}

/** The battle stream, its log and error pumps, and the guarded write. */
export function openSession(params: ReconstructParams, overallDeadline: number): ReconstructionSession {
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
        params.onLogLines?.(lines);
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

  // A sim crash inside a write must surface as a choice error so the
  // turn-sync guard skips or stops instead of taking the process down.
  const writeSim = (payload: string) => safeStreamWrite(streams.omniscient, payload, recordStreamError);

  return {
    params, battleStream, streams, collectedLog, choiceErrors, haxAlignment,
    overallDeadline,
    timedOut: false,
    recordStreamError, writeSim,
  };
}

export async function waitForBattle(
  session: ReconstructionSession,
  predicate: (battle: SimBattle) => boolean,
  timeoutMs = 1500,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const battle = session.battleStream.battle;
    if (battle && predicate(battle)) return;
    await sleep(10);
  }
}

export async function waitForLog(
  session: ReconstructionSession,
  predicate: (log: string[]) => boolean,
  timeoutMs = 1000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate(session.collectedLog)) return;
    await sleep(10);
  }
}

export async function waitForLogIdle(session: ReconstructionSession, idleMs = 50, timeoutMs = 500) {
  const { collectedLog } = session;
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
}

/** The run's stop conditions the guards share: the Cancel signal or the overall deadline. */
export function stopRequested(session: ReconstructionSession): boolean {
  return session.params.abort?.aborted === true || Date.now() > session.overallDeadline;
}

/**
 * A rejected replay choice (a team edit can remove the very move the
 * protocol used) must not abandon the turn half-chosen: the sim keeps the
 * other side's accepted choice pending, and the next write would commit the
 * turn with that stale choice — the branch then plays the user's choices one
 * commit late and a leftover switch fails with "A switch failed because the
 * Pokémon trying to switch in is already in." (gen9draft-2058494320 turn 4).
 * Answering the rejected sides with `default` commits the turn and keeps the
 * replay in lockstep; the snapshot corrections repair the aftermath.
 */
export async function commitRejectedChoicesWithDefaults(session: ReconstructionSession, turnBeforeChoice: number) {
  const { battleStream, choiceErrors } = session;
  const battle = battleStream.battle;
  if (!battle || battle.ended || battle.turn > turnBeforeChoice) return;
  const pendingSides = battle.sides.filter(side => side.requestState && !side.isChoiceDone());
  if (pendingSides.length === 0) return;
  const retryErrors = choiceErrors.count;
  session.writeSim(pendingSides.map(side => `>${side.id} default`).join('\n'));
  await waitForBattle(session, currentBattle =>
    currentBattle.ended ||
    currentBattle.turn > turnBeforeChoice ||
    hasForceSwitch(currentBattle, 0) ||
    hasForceSwitch(currentBattle, 1) ||
    choiceErrors.count > retryErrors,
  );
}

/**
 * Turn-sync guard: choices must land on the turn that produced them. Once a
 * block fails to commit its turn, every later block would feed the sim
 * choices from the wrong turn — the HP corrections mask the drift while
 * structural state diverges (the GPL replay lost a pending Future Sight and
 * opened turn 25 with the wrong active, five blocks ahead of the sim).
 * Feed defaults until the sim stands at `wantedTurn`; a false return means
 * the battle is wedged and replaying further blocks would corrupt it.
 */
export async function advanceSimToTurn(session: ReconstructionSession, wantedTurn: number): Promise<boolean> {
  const { battleStream, choiceErrors } = session;
  for (let attempts = 0; attempts < 12; attempts++) {
    const battle = battleStream.battle;
    if (!battle || battle.ended) return false;
    if (battle.turn >= wantedTurn) return true;
    if (stopRequested(session)) return false;

    const turnBefore = battle.turn;
    const pendingSides = battle.sides.filter(side => side.requestState && !side.isChoiceDone());
    if (pendingSides.length === 0) {
      // No open request — give in-flight writes a beat to surface one.
      await waitForBattle(session, current =>
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
    session.writeSim(pendingSides.map(side => `>${side.id} default`).join('\n'));
    await waitForBattle(session, current =>
      current.ended ||
      current.turn > turnBefore ||
      choiceErrors.count > errorsBefore,
    );
    if (battleStream.battle?.turn === turnBefore && choiceErrors.count > errorsBefore) return false;
  }
  return (battleStream.battle?.turn ?? 0) >= wantedTurn;
}

/**
 * Starts the battle on the FIXED seed: an unseeded battle rerolls
 * damage/secondary outcomes every reconstruction, so the same replay+turn
 * yielded DIFFERENT positions run to run (diverged fallback paths, shuffled
 * bench slots, wrong choice locks) — the sweep's cached eval and the branch
 * a click executes in could disagree about what "switch 3" even is (draft
 * T48). Team preview is answered with defaults.
 */
export async function startBattle(session: ReconstructionSession, orderedP1: PokemonSet[], orderedP2: PokemonSet[]) {
  const { params, battleStream } = session;
  const p1Packed = Teams.pack(orderedP1);
  const p2Packed = Teams.pack(orderedP2);
  const p1Name = JSON.stringify(params.playerNames?.[0]?.trim() || 'Player 1');
  const p2Name = JSON.stringify(params.playerNames?.[1]?.trim() || 'Player 2');
  session.writeSim(
    `>start {"formatid":"${params.format}","seed":"1,2,3,4"}\n>player p1 {"name":${p1Name},"team":"${p1Packed}"}\n>player p2 {"name":${p2Name},"team":"${p2Packed}"}`
  );
  await waitForBattle(session, battle => !!battle.sides[0] && !!battle.sides[1], 1000);

  const setupBattle = battleStream.battle;
  const teamPreviewCommands: string[] = [];
  if (setupBattle?.sides[0]?.requestState === 'teampreview') {
    teamPreviewCommands.push('>p1 default');
  }
  if (setupBattle?.sides[1]?.requestState === 'teampreview') {
    teamPreviewCommands.push('>p2 default');
  }

  if (teamPreviewCommands.length > 0) {
    session.writeSim(teamPreviewCommands.join('\n'));
  }
  await waitForBattle(
    session,
    battle =>
      battle.ended ||
      battle.turn > 0 ||
      battle.sides[0]?.requestState === 'move' ||
      battle.sides[1]?.requestState === 'move',
    1000,
  );
}
