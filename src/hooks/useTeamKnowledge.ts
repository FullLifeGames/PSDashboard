import type { PokemonSet } from '@pkmn/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DamageObservation, type HiddenPowerEvidence, type ItemDamageJudge, type OpponentTeamInfo, type ReplayData,
  type SpeedOrderObservation, applyPastedTeam, countMatchingSpecies, applyInferredSpreads, enrichTeamInfos,
  applyTeamSheetToInfo, enrichPokemonInfo, inferReplayFormatId, withStandIns,
} from '@fulllifegames/replay-core';
import { loadImportPools, parseSetsImport, validateSetsImport, type ImportGame } from '../lib/sets-io';
import type { EditorPools } from '../lib/team-editor';
import { buildSensitivityTargets } from '../lib/team-knowledge';
import type { ReplayWorkerClient } from '../lib/replay-jobs/client';
import type { SensitivityTarget } from '@fulllifegames/eval-engine';
import type { useSmogonUsageStats } from './useSmogonUsageStats';
import type { useSmogonSetAssumptions } from './useSmogonSetAssumptions';
import { forgetImportText, readImportText, saveTeamEdits } from '../lib/team-edits-store';
import { useRestoredTeamEdits } from './useRestoredTeamEdits';
import { useHpResolver, useSheetTeams, useSpreadSolve, useTeamPaste } from './useTeamSources';

export interface TeamKnowledgeInputs {
  replayData: ReplayData | null;
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
  /** The damage judge loaded with the inference; absent, the enrichment judges no item. */
  itemJudge?: ItemDamageJudge | null;
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
  usageStats: ReturnType<typeof useSmogonUsageStats>;
  setAssumptions: ReturnType<typeof useSmogonSetAssumptions>;
  onTeamsEdited: (next: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => void;
  replayWorker: ReplayWorkerClient;
}

function useTeamEdits(replayId: string | undefined, p1Info: OpponentTeamInfo | null, opponentInfo: OpponentTeamInfo | null) {
  const [editedP1Info, setEditedP1Info] = useState<OpponentTeamInfo | null>(null);
  const [editedP2Info, setEditedP2Info] = useState<OpponentTeamInfo | null>(null);
  const [editorSide, setEditorSide] = useState<'p1' | 'p2' | null>(null);
  const [setsPanelOpen, setSetsPanelOpen] = useState(false);
  const [editsReplayId, setEditsReplayId] = useState(replayId);
  if (editsReplayId !== replayId) {
    setEditsReplayId(replayId);
    setEditedP1Info(null);
    setEditedP2Info(null);
    setEditorSide(null);
  }
  useRestoredTeamEdits({
    replayId, p1Info, opponentInfo, edited: { p1: editedP1Info, p2: editedP2Info }, setEdited: { p1: setEditedP1Info, p2: setEditedP2Info },
  });
  return {
    editedP1Info, setEditedP1Info, editedP2Info, setEditedP2Info,
    editorSide, setEditorSide, setsPanelOpen, setSetsPanelOpen,
  };
}

function checkedImport(
  text: string, current: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }, game: ImportGame,
  shown: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null },
): { parsed: ReturnType<typeof parseSetsImport> } | { error: string } {
  let parsed: ReturnType<typeof parseSetsImport>;
  try {
    parsed = parseSetsImport(text);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not parse the sets text.' };
  }
  const invalid = validateSetsImport(parsed, current, game, shown);
  return invalid.length > 0 ? { error: `Nothing was imported. ${invalid.join(' ')}` } : { parsed };
}

function useSetsIO(args: {
  replayData: ReplayData | null;
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  shownP1Info: OpponentTeamInfo | null;
  shownP2Info: OpponentTeamInfo | null;
  replayGenNumber: number;
  setEditedP1Info: (info: OpponentTeamInfo | null) => void;
  setEditedP2Info: (info: OpponentTeamInfo | null) => void;
  onTeamsEdited: TeamKnowledgeInputs['onTeamsEdited'];
}) {
  const {
    replayData, p1Info, opponentInfo, effectiveP1Info, effectiveP2Info, shownP1Info, shownP2Info, replayGenNumber,
    setEditedP1Info, setEditedP2Info, onTeamsEdited,
  } = args;
  const pendingStoredSetsRef = useRef<string | null>(null);
  const poolsRef = useRef<{ replayId: string; pools: EditorPools } | null>(null);
  useEffect(() => {
    pendingStoredSetsRef.current = replayData?.id ? readImportText(replayData.id) : null;
  }, [replayData?.id]);

  const loadPools = useCallback(async () => {
    if (!replayData || !effectiveP1Info || !effectiveP2Info) return;
    const species = [...effectiveP1Info.pokemon, ...effectiveP2Info.pokemon].map(pokemon => pokemon.species);
    try {
      const pools = await loadImportPools(species, replayGenNumber, inferReplayFormatId(replayData));
      poolsRef.current = { replayId: replayData.id, pools };
    } catch {
      poolsRef.current = null;
    }
  }, [replayData, effectiveP1Info, effectiveP2Info, replayGenNumber]);

  // Applies the text to both sides or neither; with `route` the checked infos go there and nothing applies here.
  const applySetsText = useCallback((text: string, route?: (next: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null }) => void): string | null => {
    if (!replayData || !effectiveP1Info || !effectiveP2Info) return 'Load a replay first.';
    const pools = poolsRef.current?.replayId === replayData.id ? poolsRef.current.pools : null;
    const checked = checkedImport(text, { p1: effectiveP1Info, p2: effectiveP2Info }, { gen: replayGenNumber, pools }, { p1: shownP1Info, p2: shownP2Info });
    if ('error' in checked) return checked.error;
    const { parsed } = checked;
    const nextP1 = parsed.p1.length > 0 ? applyPastedTeam(effectiveP1Info, parsed.p1).info : effectiveP1Info;
    const nextP2 = parsed.p2.length > 0 ? applyPastedTeam(effectiveP2Info, parsed.p2).info : effectiveP2Info;
    if (route) { route({ p1: parsed.p1.length > 0 ? nextP1 : null, p2: parsed.p2.length > 0 ? nextP2 : null }); return null; }
    setEditedP1Info(nextP1);
    setEditedP2Info(nextP2);
    try {
      localStorage.setItem(`ps-replay-interceptor:sets:${replayData.id}`, text);
    } catch {
      // Storage full/blocked: the import still applies for this session.
    }
    onTeamsEdited({ p1: nextP1, p2: nextP2 });
    return null;
  }, [replayData, effectiveP1Info, effectiveP2Info, shownP1Info, shownP2Info, replayGenNumber, setEditedP1Info, setEditedP2Info, onTeamsEdited]);

  useEffect(() => {
    if (!pendingStoredSetsRef.current || !p1Info || !opponentInfo) return;
    const stored = pendingStoredSetsRef.current;
    pendingStoredSetsRef.current = null;
    applySetsText(stored);
  }, [p1Info, opponentInfo, applySetsText]);

  return { applySetsText, loadPools };
}

// Panels open after the solve: before it the infos carry usage guesses, which an import would take as the user's input.
function useOpenAfterSolve(getInferredSpreads: ReturnType<typeof useSpreadSolve>['getInferredSpreads']) {
  return useCallback((open: () => void) => {
    void getInferredSpreads().then(() => undefined, () => undefined).then(open);
  }, [getInferredSpreads]);
}

export function useTeamKnowledge(inputs: TeamKnowledgeInputs) {
  const {
    replayData, p1Info, opponentInfo, itemJudge, observations, speedOrders, hpEvidence, usageStats, setAssumptions, onTeamsEdited,
    replayWorker,
  } = inputs;
  const paste = useTeamPaste();
  const edits = useTeamEdits(replayData?.id, p1Info, opponentInfo);
  const { hpResolverFor, replayGenNumber } = useHpResolver(replayData, hpEvidence, usageStats);
  const sheetTeams = useSheetTeams(replayData);

  const enriched = useMemo(() => {
    const empty = { pokemon: [] };
    const inferred = { p1: p1Info ?? empty, p2: opponentInfo ?? empty };
    const randomSets = setAssumptions.assumptions?.randomSets;
    const sized = replayData ? withStandIns(inferred, replayData.log, usageStats.stats, { p1: paste.pastedSets ?? [] }, randomSets) : inferred;
    const both = enrichTeamInfos(sized, usageStats.stats, setAssumptions.assumptions,
      { p1: hpResolverFor('p1'), p2: hpResolverFor('p2') }, itemJudge ?? undefined);
    return { p1: p1Info ? both.p1 : null, p2: opponentInfo ? both.p2 : null };
  }, [replayData, p1Info, opponentInfo, usageStats.stats, setAssumptions.assumptions, paste.pastedSets, hpResolverFor, itemJudge]);

  const effectiveP1Info = useMemo(() => {
    if (edits.editedP1Info) return edits.editedP1Info;
    const base = enriched.p1;
    if (base && paste.pastedSets && paste.pastedSets.length > 0) {
      return applyPastedTeam(base, paste.pastedSets).info;
    }
    return base;
  }, [edits.editedP1Info, enriched, paste.pastedSets]);

  const effectiveP2Info = useMemo(() => edits.editedP2Info ?? enriched.p2, [edits.editedP2Info, enriched]);

  const { solvedSpreads, getInferredSpreads } = useSpreadSolve({
    replayData, observations, speedOrders, teamText: paste.teamText,
    effectiveP1Info, effectiveP2Info, usageStats, setAssumptions, replayWorker,
  });

  const stats = useTeamStats({ effectiveP1Info, effectiveP2Info, sheetTeams, solvedSpreads, usageStats, setAssumptions, hpResolverFor });
  const { applySetsText, loadPools } = useSetsIO({
    replayData, p1Info, opponentInfo, effectiveP1Info, effectiveP2Info, replayGenNumber,
    shownP1Info: stats.statsP1Info, shownP2Info: stats.statsP2Info,
    setEditedP1Info: edits.setEditedP1Info, setEditedP2Info: edits.setEditedP2Info, onTeamsEdited,
  });

  const openAfterSolve = useOpenAfterSolve(getInferredSpreads);
  const status = useTeamStatus({ paste, p1Info });
  const saveTeam = useSaveTeam({ replayId: replayData?.id, effectiveP1Info, effectiveP2Info, edits, onTeamsEdited });
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
    editorSide: edits.editorSide,
    setEditorSide: (side: 'p1' | 'p2' | null) => (side ? openAfterSolve(() => edits.setEditorSide(side)) : edits.setEditorSide(null)),
    setsPanelOpen: edits.setsPanelOpen,
    setSetsPanelOpen: (open: boolean) => (open
      ? openAfterSolve(() => void loadPools().then(() => edits.setSetsPanelOpen(true)))
      : edits.setSetsPanelOpen(false)),
    effectiveP1Info, effectiveP2Info, solvedSpreads, getInferredSpreads, replayGenNumber,
    applySetsText, saveTeam, setsFingerprint,
  };
}

// Coherence vetoes read the item (a Choice item drops a guessed status move): settle the moves under the solved item.
function settleMovesUnderSolvedItem(
  shown: OpponentTeamInfo, before: OpponentTeamInfo,
  enrich: (pokemon: OpponentTeamInfo['pokemon'][number]) => OpponentTeamInfo['pokemon'][number],
): OpponentTeamInfo {
  return {
    ...shown,
    pokemon: shown.pokemon.map((pokemon, index) =>
      pokemon.item.value === before.pokemon[index]?.item.value ? pokemon : { ...pokemon, moves: enrich(pokemon).moves }),
  };
}

function useTeamStats(args: {
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  sheetTeams: ReturnType<typeof useSheetTeams>;
  solvedSpreads: ReturnType<typeof useSpreadSolve>['solvedSpreads'];
  usageStats: ReturnType<typeof useSmogonUsageStats>;
  setAssumptions: ReturnType<typeof useSmogonSetAssumptions>;
  hpResolverFor: ReturnType<typeof useHpResolver>['hpResolverFor'];
}) {
  const { effectiveP1Info, effectiveP2Info, sheetTeams, solvedSpreads, usageStats, setAssumptions, hpResolverFor } = args;
  const statsInfoOf = useCallback((side: 'p1' | 'p2', effective: OpponentTeamInfo | null, sheet: PokemonSet[] | null) => {
    if (!effective) return null;
    const withSheet = applyTeamSheetToInfo(effective, sheet);
    const shown = applyInferredSpreads(withSheet, side, solvedSpreads);
    const hpResolver = hpResolverFor(side);
    return settleMovesUnderSolvedItem(shown, withSheet,
      pokemon => enrichPokemonInfo(pokemon, usageStats.stats, setAssumptions.assumptions, hpResolver));
  }, [solvedSpreads, usageStats.stats, setAssumptions.assumptions, hpResolverFor]);
  const statsP1Info = useMemo(() => statsInfoOf('p1', effectiveP1Info, sheetTeams.p1), [statsInfoOf, effectiveP1Info, sheetTeams]);
  const statsP2Info = useMemo(() => statsInfoOf('p2', effectiveP2Info, sheetTeams.p2), [statsInfoOf, effectiveP2Info, sheetTeams]);
  const sensitivityTargetsFor = useCallback((side: 'p1' | 'p2'): SensitivityTarget[] => {
    const info = side === 'p1' ? statsP1Info : statsP2Info;
    return buildSensitivityTargets(info, usageStats.stats);
  }, [statsP1Info, statsP2Info, usageStats.stats]);
  return { statsP1Info, statsP2Info, sensitivityTargetsFor };
}

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

function useSaveTeam(args: {
  replayId: string | undefined;
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  edits: ReturnType<typeof useTeamEdits>;
  onTeamsEdited: TeamKnowledgeInputs['onTeamsEdited'];
}) {
  const { replayId, effectiveP1Info, effectiveP2Info, edits, onTeamsEdited } = args;
  return useCallback((side: 'p1' | 'p2', info: OpponentTeamInfo) => {
    const nextP1Info = side === 'p1' ? info : effectiveP1Info;
    const nextP2Info = side === 'p2' ? info : effectiveP2Info;
    if (replayId) {
      saveTeamEdits(replayId, { p1: side === 'p1' ? info : edits.editedP1Info, p2: side === 'p2' ? info : edits.editedP2Info });
      forgetImportText(replayId);
    }
    if (side === 'p1') {
      edits.setEditedP1Info(info);
    } else {
      edits.setEditedP2Info(info);
    }
    edits.setEditorSide(null);
    if (nextP1Info && nextP2Info) {
      onTeamsEdited({ p1: nextP1Info, p2: nextP2Info });
    }
  }, [replayId, effectiveP1Info, effectiveP2Info, edits, onTeamsEdited]);
}

export type TeamKnowledge = ReturnType<typeof useTeamKnowledge>;
