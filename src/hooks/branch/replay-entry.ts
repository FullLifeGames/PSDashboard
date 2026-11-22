import type { BranchRuntime } from '@fulllifegames/eval-engine';
import { entryDice, turnStart } from '../../lib/branch-dice-lines';
import {
  makeHistoryEntry, requiredChoices,
  type BranchEngineModule, type BranchHistoryEntry, type BattleStream, type SideId,
} from './shared';

/**
 * Re-applying a recorded history entry to a runtime, and the lead entry of a turn-0 start: the session's rebuild and the new
 * game's rebuild (`game-rebuild.ts`) both play entries through these (moved out of `session.ts`, round 89, #105).
 */

export type ReplayEntryOutcome =
  | { ok: true; entry: BranchHistoryEntry }
  | { ok: false; error: string };

/** The commands one recorded entry resolves to against the rebuilt battle. */
function resolveEntryCommands(
  branchEngine: BranchEngineModule, battle: NonNullable<BattleStream['battle']>, entry: BranchHistoryEntry,
): { ok: true; commands: { side: SideId; command: string }[]; p1Command: string; p2Command: string } | { ok: false; error: string } {
  if (entry.kind === 'forced' && entry.forcedSide) {
    const side = entry.forcedSide;
    const slotChoices = side === 'p1' ? entry.p1SlotChoices : entry.p2SlotChoices;
    if (!slotChoices) return { ok: false, error: 'Missing forced-switch data in the branch history.' };
    const resolved = branchEngine.resolveSideChoices(battle, side, slotChoices, requiredChoices(battle, side));
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      commands: [{ side, command: resolved.command }],
      p1Command: side === 'p1' ? resolved.command : '—',
      p2Command: side === 'p2' ? resolved.command : '—',
    };
  }
  if (entry.p1SlotChoices && entry.p2SlotChoices) {
    const p1 = branchEngine.resolveSideChoices(battle, 'p1', entry.p1SlotChoices, requiredChoices(battle, 'p1'));
    if (!p1.ok) return p1;
    const p2 = branchEngine.resolveSideChoices(battle, 'p2', entry.p2SlotChoices, requiredChoices(battle, 'p2'));
    if (!p2.ok) return p2;
    return {
      ok: true,
      commands: [
        { side: 'p1', command: p1.command },
        { side: 'p2', command: p2.command },
      ],
      p1Command: p1.command,
      p2Command: p2.command,
    };
  }
  // Entries recorded before identity-based choices existed: replay verbatim.
  return {
    ok: true,
    commands: [
      { side: 'p1', command: entry.p1Choice },
      { side: 'p2', command: entry.p2Choice },
    ],
    p1Command: entry.p1Choice,
    p2Command: entry.p2Choice,
  };
}

/**
 * Re-applies one recorded history entry against a freshly rebuilt runtime.
 * Choices are re-resolved by identity against the current request, so a team
 * edit can never silently replay the wrong move — mismatches abort with a
 * visible error instead (B1).
 */
export async function replayHistoryEntry(
  runtime: BranchRuntime,
  branchEngine: BranchEngineModule,
  entry: BranchHistoryEntry,
): Promise<ReplayEntryOutcome> {
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) {
    return { ok: false, error: 'The rebuilt battle ended before this turn.' };
  }

  const turnNumber = battle.turn ?? 0;
  const resolved = resolveEntryCommands(branchEngine, battle, entry);
  if (!resolved.ok) return resolved;

  const start = turnStart(battle, runtime.log);
  const result = await branchEngine.executeBranchChoices({
    streams: runtime.streams,
    log: runtime.log,
    choiceErrors: runtime.choiceErrors,
    commands: resolved.commands,
    // the entry's slot choices carry the forced dice; a forced entry after a pause plays the rest of that turn with them (round 82)
    dice: { battle, p1Choices: entry.p1SlotChoices ?? [], p2Choices: entry.p2SlotChoices ?? [] },
  });
  if (!result.ok) return result;

  const nextState = branchEngine.createBranchState(runtime.battleStream, runtime.log, {
    p1Choices: [],
    p2Choices: [],
  });
  // The rebuild's own position replaces whatever the replayed entry carried —
  // after a team edit the old capture no longer describes this battle.
  const serializedPosition = branchEngine.captureSerializedPosition(runtime.battleStream.battle);
  return {
    ok: true,
    entry: {
      ...makeHistoryEntry(turnNumber, resolved.p1Command, resolved.p2Command, nextState),
      serializedPosition,
      kind: entry.kind ?? 'turn',
      ...(entry.forcedSide ? { forcedSide: entry.forcedSide } : {}),
      ...(entry.p1SlotChoices ? { p1SlotChoices: entry.p1SlotChoices } : {}),
      ...(entry.p2SlotChoices ? { p2SlotChoices: entry.p2SlotChoices } : {}),
      ...entryDice(result.dice, start, battle, runtime.log, nextState.p1ForceSwitch || nextState.p2ForceSwitch),
    },
  };
}

/** The lead decision IS the variation's first entry: entry 0 plays
 *  "turn 0" and the position after it is the start of turn 1. */
export function leadHistoryEntry(
  branchEngine: BranchEngineModule, runtime: BranchRuntime,
  leadOverride: { p1: string[]; p2: string[]; bring?: boolean }, startPosition: string | null,
): BranchHistoryEntry {
  const startState = branchEngine.createBranchState(runtime.battleStream, runtime.log, {
    p1Choices: [],
    p2Choices: [],
  });
  // "lead A + B · back C + D" — the leads are the first active-count
  // picks, the rest is the brought back line (VGC's 4 of 6).
  const activeCount = runtime.battleStream.battle?.sides[0]?.active.length ?? 1;
  const leadLabel = (list: string[]) => {
    const back = list.slice(activeCount);
    return `lead ${list.slice(0, activeCount).join(' + ')}${back.length > 0 ? ` · back ${back.join(' + ')}` : ''}`;
  };
  return {
    ...makeHistoryEntry(0, leadLabel(leadOverride.p1), leadLabel(leadOverride.p2), startState),
    leadChoices: {
      p1: [...leadOverride.p1],
      p2: [...leadOverride.p2],
      ...(leadOverride.bring ? { bring: true } : {}),
    },
    serializedPosition: startPosition,
  };
}

