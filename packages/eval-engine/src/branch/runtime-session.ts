import { BattleStreams, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { logRules, type TurnSnapshot } from '@fulllifegames/replay-core';
import type { ChoiceLockContext } from '../choice-lock.ts';
import type { TurnAlignmentRecord } from '../hax-alignment.ts';
import type { BranchChoiceErrorLog, PokemonIdent, SimBattle } from './types.ts';
import { reorderForLeads, trimTeamsToBring } from './team-order.ts';
import { extractLeads } from './protocol-choices.ts';
import { hasForceSwitch } from './corrections.ts';
import { recordVolatilesAtExit } from './exit-volatiles.ts';
import { safeStreamWrite, sleep } from './execute.ts';
import { loadSimMods, simModsReady } from '../forward/sim-mods.ts';
import { DEFAULT_GAME_SEED } from './game-seed.ts';

/** One open replacement request of a knockout, with the slots to fill and the species the replay sent into them. */
export interface ReplacementPoint {
  /** The knockout turn; the replacement stands on the board of the next one. */
  turn: number;
  /** The block's open requests counted from 0 (a replacement that falls to an entry hazard opens a second one). */
  ordinal: number;
  forced: { p1: number[]; p2: number[] };
  /** The species the replay sent into `forced`, in the same order. */
  played: { p1: string[]; p2: string[] };
}

/** The input of `reconstructBranchRuntime`: the teams, the replay log and the turn to rebuild to. */
export interface ReconstructParams {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  snapshot?: TurnSnapshot | null;
  /** Real replay player names; the sim sides and the winner line use them. */
  playerNames?: [string, string];
  onLogLines?: (lines: string[]) => void;
  /** Reports replay progress while rebuilding towards the target turn. */
  onProgress?: (turn: number, targetTurn: number) => void;
  /** Aborts the turn-replay loop early (the Cancel button). */
  abort?: AbortSignal;
  /** Overall replay deadline; a wedged reconstruction stops instead of hanging. */
  deadlineMs?: number;
  /** Single-pass position capture (eval sweeps): every turn boundary before targetTurn is snapshot-corrected and handed out. */
  capturePositions?: {
    snapshotFor(turn: number): TurnSnapshot | null;
    onPosition(turn: number, battle: SimBattle): void;
    /**
     * Fired for every open forced request after a knockout of the block, before the replay answers it, with the live battle (read it,
     * never write it). A request the protocol does not match (a slot the block does not faint, a slot the log sends no one into) is a gap, never a point.
     */
    onReplacement?(point: ReplacementPoint, battle: SimBattle): void;
  };
  /**
   * Raw boundary hand-out (the calibration harness's single-pass path): fired at the START of every block iteration, where a per-target
   * reconstruction with targetTurn <= this block's turn exits its loop, with the UNCORRECTED live battle. The caller clones it and applies
   * applyTargetCorrections itself, so the replay stays byte-identical to any per-target run.
   */
  onRawBoundary?: (blockTurn: number, battle: SimBattle) => void;
  /** Protocol-truth lock context: boundary corrections re-stamp the choice locks from it. */
  choiceLocks?: ChoiceLockContext;
  /**
   * Turn-0 branching: start with THESE leads instead of the replay's (species or names per side, slot order kept; null or empty keeps
   * the replay leads). Only meaningful with targetTurn 1 and no snapshot corrections: a corrected boundary puts the original leads back.
   */
  leadOverride?: { p1: string[] | null; p2: string[] | null };
  /**
   * Bring-limited formats (VGC's 4 of 6, BSS's 3 of 6): field ONLY these species per side. The branch runs on a bring-all base format,
   * which would bench never-brought Pokémon for the engine to switch into. Fail-open: a list that does not match the team exactly
   * leaves both teams whole (they trim together or not at all). `guessed[side]`: how many trailing names of that side's list are
   * guesses for a body the side brought and never fielded; they take the last party slots.
   */
  bringOnly?: { p1: string[]; p2: string[]; guessed?: { p1: number; p2: number } } | null;
  /** The dice seed of a new game's simulator; absent means `DEFAULT_GAME_SEED`, the seed of every replay rebuild. */
  seed?: string;
}

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

export function orderTeams(params: ReconstructParams): { orderedP1: PokemonSet[]; orderedP2: PokemonSet[] } {
  const { p1Leads, p2Leads } = extractLeads(params.replayLog);
  const rules = logRules(params.replayLog);
  const leadsFor = (replayLeads: PokemonIdent[], override: string[] | null | undefined): PokemonIdent[] =>
    override && override.length > 0 ? override.map(name => ({ name, species: name })) : replayLeads;
  const { p1: orderedP1, p2: orderedP2 } = trimTeamsToBring(
    reorderForLeads(params.p1Team, leadsFor(p1Leads, params.leadOverride?.p1)),
    reorderForLeads(params.p2Team, leadsFor(p2Leads, params.leadOverride?.p2)),
    params.bringOnly, rules,
  );
  return { orderedP1, orderedP2 };
}

export type SessionStreams = Pick<
  ReconstructionSession, 'battleStream' | 'streams' | 'collectedLog' | 'choiceErrors' | 'recordStreamError' | 'writeSim'
>;

export function openSession(params: ReconstructParams, overallDeadline: number): ReconstructionSession {
  const haxAlignment: TurnAlignmentRecord[] = [];
  return { params, ...openStreams(params.onLogLines), haxAlignment, overallDeadline, timedOut: false };
}

/** The target of the exit subscription: onEvent takes a Format and no more (a custom format such as gen9draft is none). */
const EXIT_RECORD_TARGET = { id: 'exitrecord', name: 'Exit record', effectType: 'Format' } as unknown as SimBattle['format'];

/**
 * Records each body's volatiles at the simulator's exits through its public onEvent: the Faint and SwitchOut events run before the
 * exit clears them. The subscription lives for one write and the battle's events go back as they were: a function in `events` would not serialize.
 */
function recordExitsDuring(battle: SimBattle | undefined, write: () => void) {
  const before = battle?.events;
  let watching = false;
  try {
    for (const event of ['Faint', 'SwitchOut']) {
      battle?.onEvent(event, EXIT_RECORD_TARGET, (target: SimBattle['sides'][number]['pokemon'][number]) => recordVolatilesAtExit(target));
    }
    watching = !!battle;
  } catch {
    // A sim that refuses the subscription plays the write unrecorded.
  }
  try {
    write();
  } finally {
    if (battle && watching) battle.events = before ?? null;
  }
}

export function openStreams(onLogLines?: (lines: string[]) => void): SessionStreams {
  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const collectedLog: string[] = [];
  const choiceErrors: BranchChoiceErrorLog = { count: 0, last: null };

  // A sim crash (old-gen mods throw on odd states) rejects these detached stream pumps: record it as a choice error so the turn-sync
  // guard reacts instead of the rejection escaping as an unhandled promise.
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

  // A sim crash inside a write surfaces as a choice error, so the turn-sync guard skips or stops instead of taking the process down.
  const writeSim = (payload: string) =>
    recordExitsDuring(battleStream.battle ?? undefined, () => safeStreamWrite(streams.omniscient, payload, recordStreamError));

  return { battleStream, streams, collectedLog, choiceErrors, recordStreamError, writeSim };
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

export function stopRequested(session: ReconstructionSession): boolean {
  return session.params.abort?.aborted === true || Date.now() > session.overallDeadline;
}

/**
 * Answers the sides of a rejected replay choice (a team edit can remove the very move the protocol used) with `default`. A turn left
 * half-chosen keeps the other side's accepted choice pending, and the next write would commit the turn with that stale choice: the branch
 * then plays the user's choices one commit late and a leftover switch fails ("A switch failed because the Pokémon trying to switch in is
 * already in."). The snapshot corrections repair the aftermath.
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
 * Turn-sync guard: choices must land on the turn that produced them. Once a block fails to commit its turn, every later block would
 * feed the sim choices from the wrong turn, and the HP corrections mask the drift while structural state diverges (a lost pending
 * Future Sight opened a turn with the wrong active). Feeds defaults until the sim stands at `wantedTurn`; false means the battle is
 * wedged and replaying further blocks would corrupt it.
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

const seedOf = (params: ReconstructParams): string => params.seed ?? DEFAULT_GAME_SEED;

/**
 * Starts the battle on the FIXED seed: an unseeded battle rerolls damage and secondary outcomes every reconstruction, so the same
 * replay and turn gave different positions (shuffled bench slots, wrong choice locks) and the cached eval and the branch could disagree
 * about what "switch 3" is. Team preview is answered with defaults; a Champions format loads its mod first.
 */
export async function startBattle(session: ReconstructionSession, orderedP1: PokemonSet[], orderedP2: PokemonSet[]) {
  const { params, battleStream } = session;
  if (!simModsReady(params.format)) await loadSimMods(params.format);
  const p1Packed = Teams.pack(orderedP1);
  const p2Packed = Teams.pack(orderedP2);
  const p1Name = JSON.stringify(params.playerNames?.[0]?.trim() || 'Player 1');
  const p2Name = JSON.stringify(params.playerNames?.[1]?.trim() || 'Player 2');
  const seed = seedOf(params);
  session.writeSim(
    `>start {"formatid":"${params.format}","seed":"${seed}"}\n>player p1 {"name":${p1Name},"team":${JSON.stringify(p1Packed)}}\n>player p2 {"name":${p2Name},"team":${JSON.stringify(p2Packed)}}`
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
