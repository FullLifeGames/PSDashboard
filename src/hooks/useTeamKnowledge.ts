import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DamageObservation, HiddenPowerEvidence, OpponentTeamInfo, ReplayData, SpeedOrderObservation } from '../types';
import { applyPastedTeam, countMatchingSpecies } from '../lib/team-paste';
import { applyInferredSpreads, enrichTeamInfo } from '../lib/team-info';
import { applyTeamSheetToInfo } from '../lib/team-sheets';
import { parseSetsImport } from '../lib/sets-io';
import { buildSensitivityTargets } from '../lib/team-knowledge';
import type { SensitivityTarget } from '../lib/eval/sensitivity';
import type { useSmogonUsageStats } from './useSmogonUsageStats';
import type { useSmogonSetAssumptions } from './useSmogonSetAssumptions';
import { useHpResolver, useSheetTeams, useSpreadSolve, useTeamPaste } from './useTeamSources';

export interface TeamKnowledgeInputs {
  replayData: ReplayData | null;
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
  usageStats: ReturnType<typeof useSmogonUsageStats>;
  setAssumptions: ReturnType<typeof useSmogonSetAssumptions>;
  /** Edited team knowledge changes the sim's inputs — App refreshes a live branch. */
  onTeamsEdited: (next: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => void;
}

/** Manual team edits and the editor/sets-panel UI state, reset per replay. */
function useTeamEdits(replayId: string | undefined) {
  const [editedP1Info, setEditedP1Info] = useState<OpponentTeamInfo | null>(null);
  const [editedP2Info, setEditedP2Info] = useState<OpponentTeamInfo | null>(null);
  const [editorSide, setEditorSide] = useState<'p1' | 'p2' | null>(null);
  const [setsPanelOpen, setSetsPanelOpen] = useState(false);
  // A freshly loaded replay must start clean: no team edits carried over
  // from the previous replay (host pages can inject replays repeatedly).
  // Render-phase adjustment, not an effect (the react-hooks v6+ gate).
  const [editsReplayId, setEditsReplayId] = useState(replayId);
  if (editsReplayId !== replayId) {
    setEditsReplayId(replayId);
    setEditedP1Info(null);
    setEditedP2Info(null);
    setEditorSide(null);
  }
  return {
    editedP1Info, setEditedP1Info, editedP2Info, setEditedP2Info,
    editorSide, setEditorSide, setsPanelOpen, setSetsPanelOpen,
  };
}

/** Import/export sets text, persisted per replay and re-applied on load. */
function useSetsIO(args: {
  replayData: ReplayData | null;
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  setEditedP1Info: (info: OpponentTeamInfo | null) => void;
  setEditedP2Info: (info: OpponentTeamInfo | null) => void;
  onTeamsEdited: TeamKnowledgeInputs['onTeamsEdited'];
}) {
  const { replayData, p1Info, opponentInfo, effectiveP1Info, effectiveP2Info, setEditedP1Info, setEditedP2Info, onTeamsEdited } = args;
  const pendingStoredSetsRef = useRef<string | null>(null);
  useEffect(() => {
    // Sets imported for this replay earlier are re-applied once the fresh
    // inference is available (see the effect below).
    pendingStoredSetsRef.current = replayData?.id
      ? localStorage.getItem(`ps-replay-interceptor:sets:${replayData.id}`)
      : null;
  }, [replayData?.id]);

  /** Applies a sets-import text to both sides; returns an error message or null. */
  const applySetsText = useCallback((text: string): string | null => {
    if (!replayData || !effectiveP1Info || !effectiveP2Info) return 'Load a replay first.';
    let parsed: ReturnType<typeof parseSetsImport>;
    try {
      parsed = parseSetsImport(text);
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not parse the sets text.';
    }
    const nextP1 = parsed.p1.length > 0 ? applyPastedTeam(effectiveP1Info, parsed.p1).info : effectiveP1Info;
    const nextP2 = parsed.p2.length > 0 ? applyPastedTeam(effectiveP2Info, parsed.p2).info : effectiveP2Info;
    setEditedP1Info(nextP1);
    setEditedP2Info(nextP2);
    try {
      localStorage.setItem(`ps-replay-interceptor:sets:${replayData.id}`, text);
    } catch {
      // Storage full/blocked — the import still applies for this session.
    }
    onTeamsEdited({ p1: nextP1, p2: nextP2 });
    return null;
  }, [replayData, effectiveP1Info, effectiveP2Info, setEditedP1Info, setEditedP2Info, onTeamsEdited]);

  // Re-apply this replay's stored sets once the fresh inference exists.
  useEffect(() => {
    if (!pendingStoredSetsRef.current || !p1Info || !opponentInfo) return;
    const stored = pendingStoredSetsRef.current;
    pendingStoredSetsRef.current = null;
    applySetsText(stored);
  }, [p1Info, opponentInfo, applySetsText]);

  return { applySetsText };
}

export function useTeamKnowledge(inputs: TeamKnowledgeInputs) {
  const { replayData, p1Info, opponentInfo, observations, speedOrders, hpEvidence, usageStats, setAssumptions, onTeamsEdited } = inputs;
  const paste = useTeamPaste();
  const edits = useTeamEdits(replayData?.id);
  const { hpResolverFor, replayGenNumber } = useHpResolver(replayData, hpEvidence, usageStats);
  const sheetTeams = useSheetTeams(replayData);

  const effectiveP1Info = useMemo(() => {
    if (edits.editedP1Info) return edits.editedP1Info;
    const base = p1Info ? enrichTeamInfo(p1Info, usageStats.stats, setAssumptions.assumptions, hpResolverFor('p1')) : null;
    // A pasted team overlays the player's side as green "manual" data (G15).
    if (base && paste.pastedSets && paste.pastedSets.length > 0) {
      return applyPastedTeam(base, paste.pastedSets).info;
    }
    return base;
  }, [edits.editedP1Info, p1Info, usageStats.stats, setAssumptions.assumptions, paste.pastedSets, hpResolverFor]);

  const effectiveP2Info = useMemo(() => {
    if (edits.editedP2Info) return edits.editedP2Info;
    return opponentInfo ? enrichTeamInfo(opponentInfo, usageStats.stats, setAssumptions.assumptions, hpResolverFor('p2')) : null;
  }, [edits.editedP2Info, opponentInfo, usageStats.stats, setAssumptions.assumptions, hpResolverFor]);

  const { solvedSpreads, getInferredSpreads } = useSpreadSolve({
    replayData, observations, speedOrders, teamText: paste.teamText,
    effectiveP1Info, effectiveP2Info, usageStats, setAssumptions,
  });

  const { applySetsText } = useSetsIO({
    replayData, p1Info, opponentInfo, effectiveP1Info, effectiveP2Info,
    setEditedP1Info: edits.setEditedP1Info, setEditedP2Info: edits.setEditedP2Info, onTeamsEdited,
  });

  const status = useTeamStatus({ paste, p1Info });
  const stats = useTeamStats({ effectiveP1Info, effectiveP2Info, sheetTeams, solvedSpreads, usageStats });
  const saveTeam = useSaveTeam({ effectiveP1Info, effectiveP2Info, edits, onTeamsEdited });
  const setsFingerprint = useMemo(
    () => JSON.stringify([edits.editedP1Info, edits.editedP2Info, paste.teamText]),
    [edits.editedP1Info, edits.editedP2Info, paste.teamText],
  );

  return {
    ...status,
    ...stats,
    teamText: paste.teamText, handleTeamLoad: paste.handleTeamLoad,
    editedP1Info: edits.editedP1Info, editedP2Info: edits.editedP2Info,
    setEditedP1Info: edits.setEditedP1Info, setEditedP2Info: edits.setEditedP2Info,
    editorSide: edits.editorSide, setEditorSide: edits.setEditorSide,
    setsPanelOpen: edits.setsPanelOpen, setSetsPanelOpen: edits.setSetsPanelOpen,
    effectiveP1Info, effectiveP2Info, solvedSpreads, getInferredSpreads, replayGenNumber,
    applySetsText, saveTeam, setsFingerprint,
  };
}

/** Stats-panel team views: sheet knowledge + solved spreads applied. */
function useTeamStats(args: {
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  sheetTeams: ReturnType<typeof useSheetTeams>;
  solvedSpreads: ReturnType<typeof useSpreadSolve>['solvedSpreads'];
  usageStats: ReturnType<typeof useSmogonUsageStats>;
}) {
  const { effectiveP1Info, effectiveP2Info, sheetTeams, solvedSpreads, usageStats } = args;
  const statsP1Info = useMemo(
    () => (effectiveP1Info
      ? applyInferredSpreads(applyTeamSheetToInfo(effectiveP1Info, sheetTeams.p1), 'p1', solvedSpreads)
      : null),
    [effectiveP1Info, sheetTeams, solvedSpreads],
  );
  const statsP2Info = useMemo(
    () => (effectiveP2Info
      ? applyInferredSpreads(applyTeamSheetToInfo(effectiveP2Info, sheetTeams.p2), 'p2', solvedSpreads)
      : null),
    [effectiveP2Info, sheetTeams, solvedSpreads],
  );
  const sensitivityTargetsFor = useCallback((side: 'p1' | 'p2'): SensitivityTarget[] => {
    const info = side === 'p1' ? statsP1Info : statsP2Info;
    return buildSensitivityTargets(info, usageStats.stats);
  }, [statsP1Info, statsP2Info, usageStats.stats]);
  return { statsP1Info, statsP2Info, sensitivityTargetsFor };
}

/** Paste status lines for the loader (match count, ignored-paste warning). */
function useTeamStatus(args: { paste: ReturnType<typeof useTeamPaste>; p1Info: OpponentTeamInfo | null }) {
  const { paste, p1Info } = args;
  const teamPasteStatus = useMemo(() => {
    if (!paste.pastedSets || paste.pastedSets.length === 0) return null;
    if (!p1Info) return `Team loaded (${paste.pastedSets.length} Pokémon)`;
    const matched = countMatchingSpecies(p1Info, paste.pastedSets);
    return `Team loaded (${paste.pastedSets.length} Pokémon, ${matched} match this replay)`;
  }, [paste.pastedSets, p1Info]);
  const teamPasteMismatch = useMemo(() => {
    if (!paste.pastedSets || paste.pastedSets.length === 0 || !p1Info) return null;
    return countMatchingSpecies(p1Info, paste.pastedSets) === 0
      ? 'None of the pasted Pokémon appear in this replay; the paste will be ignored for branching.'
      : null;
  }, [paste.pastedSets, p1Info]);
  return { teamPasteStatus, teamPasteError: paste.teamPasteParseError || teamPasteMismatch };
}

/** Save from the team editor: apply the edit, close the editor, refresh. */
function useSaveTeam(args: {
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  edits: ReturnType<typeof useTeamEdits>;
  onTeamsEdited: TeamKnowledgeInputs['onTeamsEdited'];
}) {
  const { effectiveP1Info, effectiveP2Info, edits, onTeamsEdited } = args;
  return useCallback((side: 'p1' | 'p2', info: OpponentTeamInfo) => {
    const nextP1Info = side === 'p1' ? info : effectiveP1Info;
    const nextP2Info = side === 'p2' ? info : effectiveP2Info;
    if (side === 'p1') {
      edits.setEditedP1Info(info);
    } else {
      edits.setEditedP2Info(info);
    }
    edits.setEditorSide(null);
    if (nextP1Info && nextP2Info) {
      onTeamsEdited({ p1: nextP1Info, p2: nextP2Info });
    }
  }, [effectiveP1Info, effectiveP2Info, edits, onTeamsEdited]);
}

export type TeamKnowledge = ReturnType<typeof useTeamKnowledge>;
