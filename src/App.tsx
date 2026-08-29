import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import { useReplay } from './hooks/useReplay';
import { finalPlayedTurn } from './lib/replay-turns';
import { useEmbedHost } from './hooks/useEmbedHost';
import { useBranch } from './hooks/useBranch';
import type { BranchHistoryEntry, BranchSimState } from './hooks/useBranch';
import type { PickerSource } from './lib/picker-state';
import { useSmogonUsageStats } from './hooks/useSmogonUsageStats';
import { useSmogonSetAssumptions } from './hooks/useSmogonSetAssumptions';
import { ReplayLoader } from './components/ReplayLoader';
import { PSReplayFrame } from './components/PSReplayFrame';
import { BranchPanel, type PlayedPick } from './components/BranchPanel';
import { LeadPanel, type LeadOption } from './components/LeadPanel';
import { BranchHistoryPanel } from './components/BranchHistoryPanel';
import { BranchSaveSharePanel } from './components/BranchSaveSharePanel';
import { BattleStatsPanel } from './components/BattleStatsPanel';
import { applyTeamSheetToInfo } from './lib/team-sheets';
import { TeamEditor } from './components/TeamEditor';
import { SetsImportExportPanel } from './components/SetsImportExportPanel';
import { EvalPanel } from './components/EvalPanel';
import { needsSettingsUpgrade, resolveAutoTurnSettings, useEvaluation, type TurnEvalSettings } from './hooks/useEvaluation';
import { buildSetsExport, parseSetsImport } from './lib/sets-io';
import { parseTeamText } from './lib/team-parser';
import { applyInferredSpreads, enrichTeamInfo, manualMove } from './lib/team-info';
import { alternativeItems } from './lib/smogon-stats';
import type { SensitivityTarget } from './lib/eval/sensitivity';
import { applyPastedTeam, countMatchingSpecies, parsePastedTeam, type PastedSet } from './lib/team-paste';
import type { OpponentTeamInfo, TurnSnapshot } from './types';
import { decodeBranchShare, type BranchSharePayload } from './lib/branch-share';
import { formatEnforcesSleepClause, getBranchSimulatorFormat, getReplayBringCount, getReplayGameType, getReplayGeneration, inferReplayFormatId } from './lib/replay-format';
import { resolveTeraPreference } from './lib/eval/tera';
import { summarizeAlignment, type TurnAlignmentRecord } from './lib/hax-alignment';
import { choiceId, evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSlotChoice } from './lib/branch-choices';
import type { EvalResult, RankedChoice } from './lib/eval/types';
import { allTurnEvents, detectSacks, parseLeadSpecies, parsePlayedActions, parsePlayedActionsDoubles } from './lib/eval/played';
import { analyzeTurn, decidedSeenKey, PAYOFF_WINDOW, unansweredSeenKey, type TurnAnalysis } from './lib/eval/analysis';
import { toID } from '@pkmn/dex';
import type { StreakHistoryEntry } from './lib/eval/streaks';
import { computeRead, parseTendencies } from './lib/eval/opponent-model';
import { analyzeLeads } from './lib/eval/leads';
import { buildGameReport, type GameReport } from './lib/eval/report';
import {
  classifyDeviation, keptEntries, normalizePosition, sliderMax, variationCovers, variationTip,
  type TimelinePosition, type VariationSpan, type ViewLine,
} from './lib/timeline';
import { nextPlayOutStep, playOutDoneText } from './lib/play-out';

const TEAM_PASTE_STORAGE_KEY = 'ps-replay-interceptor:team-paste';

function SharedBranchView({
  branch,
  onLoadOriginal,
  onClear,
}: {
  branch: BranchSharePayload;
  onLoadOriginal: (replayId: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="ps-main-layout">
      <div className="ps-main-left">
        <div className="ps-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span className="ps-format-tag">{branch.format}</span>
            <span style={{ fontSize: 11, color: '#8ac' }}>{branch.players[0]}</span>
            <span style={{ fontSize: 10, color: '#556' }}>vs</span>
            <span style={{ fontSize: 11, color: '#c8a' }}>{branch.players[1]}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
              Shared Branch
            </span>
            <button
              type="button"
              className="ps-btn"
              onClick={() => onLoadOriginal(branch.replayId)}
              style={{ padding: '2px 8px', fontSize: 10 }}
            >
              Load Original Replay
            </button>
            <button
              type="button"
              className="ps-btn"
              onClick={onClear}
              style={{ padding: '2px 8px', fontSize: 10 }}
            >
              New Replay
            </button>
          </div>
        </div>
        <div className="ps-iframe-wrap">
          <PSReplayFrame
            log={branch.finalLog}
            format={branch.format}
            p1={branch.players[0]}
            p2={branch.players[1]}
            title="Shared Branch Replay"
            height={480}
            seekTurn={branch.branchTurn}
            autoPlay={false}
            reloadKey={`shared:${branch.replayId}:${branch.createdAt}`}
          />
        </div>
        <div className="ps-panel ps-shared-branch-panel">
          <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Branch Choices</div>
          <div style={{ fontSize: 11, color: '#aebdd0', marginBottom: 8 }}>
            Branch started from turn {branch.branchTurn}. This read-only view replays the shared alternate line.
          </div>
          <div className="ps-shared-choice-list">
            {branch.choices.length > 0 ? branch.choices.map(choice => (
              <div key={`${choice.turnNumber}-${choice.p1Choice}-${choice.p2Choice}`} className="ps-shared-choice-row">
                Turn {choice.turnNumber}: P1 {choice.p1Choice} / P2 {choice.p2Choice}
              </div>
            )) : (
              <div className="ps-shared-choice-row">No executed branch choices were stored.</div>
            )}
          </div>
        </div>
      </div>
      <div className="ps-main-right">
        <div className="ps-panel" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Replay Source</div>
          <div style={{ fontSize: 11, color: '#aebdd0', lineHeight: 1.5 }}>
            Replay id: <strong style={{ color: '#fff' }}>{branch.replayId}</strong>
            <br />
            Created: {new Date(branch.createdAt).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Species each side actually BROUGHT, in first-seen order (the pre-turn-1
 *  actives — the leads — come first): active in ANY snapshot counts. */
function broughtSpeciesFor(snapshots: TurnSnapshot[], side: 'p1' | 'p2'): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const turn of snapshots) {
    for (const pokemon of turn[side].pokemon) {
      if (pokemon.isActive && !seen.has(pokemon.speciesForme)) {
        seen.add(pokemon.speciesForme);
        ordered.push(pokemon.speciesForme);
      }
    }
  }
  return ordered;
}

function App() {
  const { loading, error, replayData, snapshots, observations, speedOrders, hpEvidence, opponentInfo, p1Info, loadReplay, loadReplayFile } = useReplay();
  const { embed, requestedReplay } = useEmbedHost({ loadReplay, loadReplayFile });
  const {
    branching, simState, history, executeError, executing,
    variationStartTurn, startSerialized,
    startBranch, setChoice, executeTurn, stopBranch, getBattle,
  } = useBranch();
  const evaluation = useEvaluation();
  const branchWindowOpenRef = useRef(false);
  const usageStats = useSmogonUsageStats(replayData?.formatid);
  const revealedSpecies = useMemo(() => {
    const p1 = p1Info?.pokemon.map(pokemon => pokemon.species) ?? [];
    const p2 = opponentInfo?.pokemon.map(pokemon => pokemon.species) ?? [];
    return [...new Set([...p1, ...p2])];
  }, [p1Info, opponentInfo]);
  const setAssumptions = useSmogonSetAssumptions(replayData?.formatid, revealedSpecies);

  const [teamText, setTeamText] = useState('');
  const [pastedSets, setPastedSets] = useState<PastedSet[] | null>(null);
  const [teamPasteError, setTeamPasteError] = useState<string | null>(null);
  const [editorSide, setEditorSide] = useState<'p1' | 'p2' | null>(null);
  const [setsPanelOpen, setSetsPanelOpen] = useState(false);
  const pendingStoredSetsRef = useRef<string | null>(null);
  const [editedP1Info, setEditedP1Info] = useState<OpponentTeamInfo | null>(null);
  const [editedP2Info, setEditedP2Info] = useState<OpponentTeamInfo | null>(null);
  /**
   * Honest divergence notice: guessed sets can make the branch replay
   * DIVERGE from the real game — in the worst case the simulated game ends
   * before the requested turn (GPL T39: three rejected choices, sim winner
   * declared early). Playing recommendations into that dead sim produced
   * baffling errors ("more choices than unfainted Pokémon"); instead the
   * divergence is surfaced and play-outs are refused.
   */
  const [branchDivergence, setBranchDivergence] = useState<string | null>(null);
  const [viewTurn, setViewTurnState] = useState(1);
  /**
   * Synchronous mirror of viewTurn: a slider change followed by an
   * immediate "Branch Here" click can fire BEFORE React commits the
   * re-render, so the click handler's closure still holds the old turn
   * (the branch then starts on the wrong turn — seen as e2e flake under
   * CPU load, but a real race for fast human hands too). Handlers that
   * act on the selected turn read the ref, never the closure state.
   */
  const viewTurnRef = useRef(1);
  const setViewTurn = useCallback((value: number | ((turn: number) => number)) => {
    // The REF is authoritative and written synchronously in the event —
    // a setState updater only runs at the NEXT render, which is exactly
    // the window the race lives in.
    const next = typeof value === 'function' ? value(viewTurnRef.current) : value;
    viewTurnRef.current = next;
    setViewTurnState(next);
  }, []);
  const [branchPreparing, setBranchPreparing] = useState(false);
  const [branchProgress, setBranchProgress] = useState<{ turn: number; target: number } | null>(null);
  const branchAbortRef = useRef<AbortController | null>(null);
  const [branchSession, setBranchSession] = useState(0);
  const [analysisTurn, setAnalysisTurn] = useState<number | null>(null);
  const [animateBranchTurns, setAnimateBranchTurns] = useState(true);
  const [sharedBranch, setSharedBranch] = useState<BranchSharePayload | null>(null);
  const [sharedBranchError, setSharedBranchError] = useState<string | null>(null);
  const [pendingBranchRefresh, setPendingBranchRefresh] = useState<{
    p1Info: OpponentTeamInfo;
    p2Info: OpponentTeamInfo;
    history: BranchHistoryEntry[];
    p1Choices: (BranchSlotChoice | null)[];
    p2Choices: (BranchSlotChoice | null)[];
  } | null>(null);

  const maxTurn = snapshots.length > 0 ? snapshots.length : 1;
  const replayGen = useMemo(() => replayData ? getReplayGeneration(replayData) : 9, [replayData]);
  /** Bring-limited team preview (VGC 4 of 6, BSS 3 of 6) — null brings all. */
  const bringCount = useMemo(
    () => (replayData ? getReplayBringCount(replayData) : null),
    [replayData],
  );

  // The last snapshot is the post-battle end state when it holds the final
  // turn's residue instead of starting a new |turn| — it is labelled "End",
  // kept stable against iframe echoes, and blocked as a branch target
  // (B10/B12/G23).
  const endSnapshotTurn = useMemo(() => {
    if (snapshots.length < 2) return null;
    const last = snapshots[snapshots.length - 1];
    return last.log.some(line => line.startsWith('|turn|')) ? null : last.turn;
  }, [snapshots]);
  const atEndPosition = endSnapshotTurn !== null && viewTurn >= endSnapshotTurn;

  // ── Unified timeline: one pointer over main line + at most one variation ──
  const [viewLine, setViewLine] = useState<ViewLine>('main');
  /**
   * Turn 0 as a view: the team-preview position before the leads walk out.
   * Not a slider position (the pointer model starts at turn 1) — while set,
   * the replay frame seeks to the preview and the lead picker replaces the
   * turn pickers. Any turn navigation clears it.
   */
  const [viewT0, setViewT0] = useState(false);
  /**
   * Draft choices for positions WITHOUT the live sim (variant B pickers):
   * collected here, executed via requestDeviation → rebuild → executeTurn.
   * Cleared on every navigation — a draft belongs to one position.
   */
  const [draftChoices, setDraftChoices] = useState<{ p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }>({ p1: [], p2: [] });
  /** Inline confirm for main-line deviations that would replace the variation. */
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; proceed: () => void } | null>(null);
  /** The variation as a pure span: null until a turn actually executed.
   *  Forced interludes do not consume a turn (mirrors alignHistoryRows). */
  const variationSpan = useMemo<VariationSpan | null>(() => {
    if (variationStartTurn === null) return null;
    const turnEntries = history.filter(entry => entry.kind !== 'forced').length;
    return turnEntries > 0 ? { startTurn: variationStartTurn, length: turnEntries } : null;
  }, [variationStartTurn, history]);
  const viewingVariation = viewLine === 'variation' && variationCovers(variationSpan, viewTurn);
  /** Where the live sim stands (the tip of what has been replayed/executed). */
  const liveSimTurn = branching && variationStartTurn !== null
    ? variationStartTurn + (variationSpan?.length ?? 0)
    : null;
  /** The pointer sits ON the live sim — pickers/executes go straight to it. */
  const liveTip = liveSimTurn !== null && viewTurn === liveSimTurn
    && (variationSpan === null || viewingVariation);
  /** Positions whose evaluation is the LIVE single result (Evaluate button,
   *  eval bar) rather than the main line's stored graph data: the live sim's
   *  position — which, freshly materialized without entries, still sits on
   *  the main line — and every recorded variation position. */
  const liveEvalView = liveTip || viewingVariation;
  /**
   * Identity of the position on screen for the eval result. A run that
   * finishes after the user navigated away carries the OLD position's tag —
   * such a result renders as stale and is never recorded under the new turn.
   */
  const evalViewKey = `${viewingVariation ? 'variation' : 'main'}:${viewTurn}`;
  const evalResultMatchesView = evaluation.resultTag === null || evaluation.resultTag === evalViewKey;
  const liveEvalStatus: typeof evaluation.status =
    evaluation.status === 'done' && !evalResultMatchesView ? 'stale' : evaluation.status;

  /**
   * One-shot seek command for the branch iframe, which ignores seekTurn prop
   * changes after mount (re-seeking every render fought the append stream).
   * Bumped by user navigation; the tip-follow after an executed turn skips it
   * (the append message already positions the frame, animated when enabled).
   */
  const [navSeek, setNavSeek] = useState<{ turn: number; seq: number; play?: boolean } | null>(null);

  // Programmatic seeks (graph clicks, timeline navigation) race the embed's
  // turn echoes: while the iframe is still seeking it keeps reporting the OLD
  // turn, which would knock the fresh selection straight back (the analysis
  // flipped to the previous turn under load; leaving a variation, the freshly
  // remounted replay frame echoed its boot position over the chosen turn).
  // Stale echoes are ignored until the embed confirms the seek or the window
  // lapses.
  const seekIntentRef = useRef<{ turn: number; until: number } | null>(null);

  // Mirrors for the play-out state and its stop, declared before navigateTo
  // (the state itself lives further down): user navigation while the engine
  // plays must STOP the run — the loop only advances while the pointer sits
  // on the live tip, so a silent stall with "Engine is playing…" frozen was
  // the alternative. Internal navigations (tip-follow, the finish's return
  // to the start turn) keep the run alive.
  const playOutRef = useRef<{ active: boolean } | null>(null);
  const stopPlayOutRef = useRef<((opts?: { returnToStart?: boolean }) => void) | null>(null);

  const navigateTo = useCallback((position: TimelinePosition, opts?: { seek?: boolean; internal?: boolean }) => {
    if (!opts?.internal && playOutRef.current?.active) {
      stopPlayOutRef.current?.({ returnToStart: false });
    }
    const next = normalizePosition(position, maxTurn, variationSpan);
    setViewT0(false);
    setViewTurn(next.turn);
    // The stored line is the user's INTENT, sticky across uncovered turns:
    // stepping back past the branch point and forward again must return to
    // the variation, not silently strand the user on the main line. Only an
    // explicit 'main' request (chip, notation, graph) leaves the variation.
    const sticky: ViewLine =
      variationSpan === null ? 'main'
      : next.line === 'variation' ? 'variation'
      : position.line;
    setViewLine(sticky);
    setDraftChoices({ p1: [], p2: [] });
    if (opts?.seek !== false) {
      setNavSeek(prev => ({ turn: next.turn, seq: (prev?.seq ?? 0) + 1 }));
      seekIntentRef.current = { turn: next.turn, until: Date.now() + 4000 };
    }
  }, [maxTurn, variationSpan, setViewTurn]);

  const discardVariation = useCallback(() => {
    branchWindowOpenRef.current = false;
    stopBranch();
    setBranchDivergence(null);
    setPendingConfirm(null);
    setPlayOut(null);
    setPlayOutNotice(null);
    setDraftChoices({ p1: [], p2: [] });
    setVariationScores([]);
    setViewLine('main');
    setViewTurn(current => Math.min(current, maxTurn));
  }, [stopBranch, maxTurn, setViewTurn]);

  // Executed turns move the pointer WITH the play — the tip is where the
  // next choice happens (chess: the board follows the line you play).
  const tipTurn = variationSpan ? variationTip(variationSpan) : null;
  useEffect(() => {
    if (!branching || tipTurn === null) return;
    navigateTo({ turn: tipTurn, line: 'variation' }, { seek: false, internal: true });
  }, [branching, tipTurn, navigateTo]);

  /**
   * Recorded position for the VIEWED variation turn: the state after the
   * (viewTurn − startTurn)-th turn entry plus its trailing forced interludes.
   * Null when capture failed or the pointer is elsewhere.
   */
  const serializedAtView = useMemo(() => {
    if (!viewingVariation || !variationSpan) return null;
    const wanted = viewTurn - variationSpan.startTurn;
    let consumed = 0;
    let last: string | null = null;
    for (const entry of history) {
      if (entry.kind !== 'forced') {
        if (consumed === wanted) break;
        consumed += 1;
      }
      if (consumed <= wanted) last = entry.serializedPosition ?? null;
    }
    return consumed === wanted ? last : null;
  }, [viewingVariation, variationSpan, viewTurn, history]);

  /**
   * Variation evals for the graph overlay: variationScores[turn − 1] = score
   * of the variation position before that turn. Session-scoped — filled by
   * whatever evaluation runs while the pointer sits on the variation, and
   * cut with the entries it belonged to.
   */
  const [variationScores, setVariationScores] = useState<(number | null)[]>([]);

  // A freshly loaded replay must start clean: slider at turn 1 (B11), no live
  // branch, and no team edits carried over from the previous replay. Host
  // pages can inject replays repeatedly via ps-load-replay, so the previous
  // game's state must never leak into the next one.
  useEffect(() => {
    setViewTurn(1);
    setViewLine('main');
    setViewT0(false);
    setDraftChoices({ p1: [], p2: [] });
    setPendingConfirm(null);
    setPlayOut(null);
    setPlayOutNotice(null);
    setVariationScores([]);
    setNavSeek(null);
    setBranchDivergence(null);
    branchWindowOpenRef.current = false;
    stopBranch();
    setEditedP1Info(null);
    setEditedP2Info(null);
    setEditorSide(null);
    // Sets imported for this replay earlier are re-applied once the fresh
    // inference is available (see the effect below).
    pendingStoredSetsRef.current = replayData?.id
      ? localStorage.getItem(`ps-replay-interceptor:sets:${replayData.id}`)
      : null;
  }, [replayData?.id, stopBranch, setViewTurn]);

  const handleTeamLoad = useCallback((rawText: string) => {
    const processed = parseTeamText(rawText);
    if (!processed.trim()) {
      setTeamText('');
      setPastedSets(null);
      setTeamPasteError(null);
      localStorage.removeItem(TEAM_PASTE_STORAGE_KEY);
      return;
    }

    // Reject pastes that contain no recognizable sets instead of silently
    // showing "Team loaded" for garbage input (G15).
    const sets = parsePastedTeam(processed);
    if (sets.length === 0) {
      setTeamPasteError('Could not read any Pokémon sets from the paste: expected the Showdown export format.');
      return;
    }

    setTeamText(processed);
    setPastedSets(sets);
    setTeamPasteError(null);
    try {
      localStorage.setItem(TEAM_PASTE_STORAGE_KEY, processed);
    } catch {
      // Storage full/blocked — the paste still works for this session.
    }
  }, []);

  // A paste should survive a reload (G15).
  useEffect(() => {
    const saved = localStorage.getItem(TEAM_PASTE_STORAGE_KEY);
    if (!saved?.trim()) return;
    const sets = parsePastedTeam(saved);
    if (sets.length === 0) return;
    setTeamText(saved);
    setPastedSets(sets);
  }, []);

  // Lazily loaded hidden-power module (Dex dependency) for the display-side
  // HP-type resolver; the enrich memos re-run once it arrives.
  const [hpModule, setHpModule] = useState<typeof import('./lib/hidden-power') | null>(null);
  const replayGenNumber = useMemo(() =>
    parseInt(replayData?.log.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10), [replayData]);
  const hpResolverFor = useCallback((side: 'p1' | 'p2') => {
    if (!hpModule) return undefined;
    const sideEvidence = hpEvidence.filter(entry => entry.attackerSide === side);
    return (species: string) =>
      hpModule.resolveHiddenPowerType(sideEvidence, usageStats.stats, species, replayGenNumber);
  }, [hpModule, hpEvidence, usageStats.stats, replayGenNumber]);

  const effectiveP1Info = useMemo(() => {
    if (editedP1Info) return editedP1Info;
    const base = p1Info ? enrichTeamInfo(p1Info, usageStats.stats, setAssumptions.assumptions, hpResolverFor('p1')) : null;
    // A pasted team overlays the player's side as green "manual" data (G15).
    if (base && pastedSets && pastedSets.length > 0) {
      return applyPastedTeam(base, pastedSets).info;
    }
    return base;
  }, [editedP1Info, p1Info, usageStats.stats, setAssumptions.assumptions, pastedSets, hpResolverFor]);

  const effectiveP2Info = useMemo(() => {
    if (editedP2Info) return editedP2Info;
    return opponentInfo ? enrichTeamInfo(opponentInfo, usageStats.stats, setAssumptions.assumptions, hpResolverFor('p2')) : null;
  }, [editedP2Info, opponentInfo, usageStats.stats, setAssumptions.assumptions, hpResolverFor]);

  useEffect(() => {
    if (!replayData) return;
    void import('./lib/team-builder');
    void import('./lib/branch-engine');
    // The display-side HP-type resolver pulls @pkmn/sim's Dex — keep it out
    // of the main chunk and hand the loaded module to the enrich memos.
    void import('./lib/hidden-power').then(module => setHpModule(module));
  }, [replayData]);

  // The damage-consistent spread solve is deterministic per replay but runs
  // thousands of calc calls — cache it across the build call sites instead of
  // re-solving on every branch/eval build. Lazy (ref, not useMemo) so
  // team-builder stays out of the main bundle.
  const spreadSolveRef = useRef<{ key: unknown[]; value: Map<string, import('./lib/spread-inference').SpreadCandidate> } | null>(null);
  // Mirror of the latest solve for the stats panel's provenance display.
  const [solvedSpreads, setSolvedSpreads] = useState<Map<string, import('./lib/spread-inference').SpreadCandidate> | null>(null);
  useEffect(() => {
    spreadSolveRef.current = null;
    setSolvedSpreads(null);
  }, [replayData]);
  const getInferredSpreads = useCallback(async (
    p1InfoOverride?: OpponentTeamInfo | null,
    p2InfoOverride?: OpponentTeamInfo | null,
  ) => {
    if (!replayData || (observations.length === 0 && speedOrders.length === 0)) return undefined;
    const info1 = p1InfoOverride ?? effectiveP1Info;
    const info2 = p2InfoOverride ?? effectiveP2Info;
    const key = [replayData, observations, speedOrders, teamText, info1, info2, usageStats.stats, setAssumptions.assumptions];
    const cached = spreadSolveRef.current;
    if (cached && cached.key.length === key.length && cached.key.every((entry, index) => entry === key[index])) {
      return cached.value;
    }
    const { solveReplaySpreads } = await import('./lib/team-builder');
    const value = solveReplaySpreads(replayData.log, observations, {
      userTeamText: teamText || undefined,
      p1Info: info1,
      p2Info: info2,
      usageStats: usageStats.stats,
      setAssumptions: setAssumptions.assumptions,
      speedOrders,
    });
    spreadSolveRef.current = { key, value };
    setSolvedSpreads(value);
    return value;
  }, [replayData, observations, speedOrders, teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions]);

  // Share links must also work in an already-open tab (G17) — listen for
  // hash changes instead of only parsing on the initial load.
  useEffect(() => {
    const applyHash = () => {
      const match = window.location.hash.match(/^#branch=(.+)$/);
      if (!match) {
        setSharedBranch(null);
        return;
      }

      try {
        const decoded = decodeBranchShare(match[1]);
        if (decoded.version !== 1 || !decoded.finalLog || !decoded.replayId) {
          throw new Error('unsupported payload');
        }
        setSharedBranch(decoded);
        setSharedBranchError(null);
      } catch {
        // A damaged link gets a readable message instead of a raw JSON parse
        // error, and the broken hash leaves the URL (G18).
        setSharedBranch(null);
        setSharedBranchError('This share link is invalid or damaged. Ask for a fresh link.');
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  /**
   * Rebuilds the live sim at `position` and prefills the pickers: the proven
   * team-edit-refresh path (reconstruct to the variation start + replay the
   * kept history entries), now the single road every deviation takes. Only
   * an EXECUTED move truncates — callers invoke this at execute time, never
   * for navigation.
   */
  const rebuildAt = useCallback(async (
    position: TimelinePosition,
    prefill: { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] } | null,
    leadOverride?: { p1: string[]; p2: string[]; bring?: boolean },
  ) => {
    if (!replayData || branchPreparing) return;
    const kind = classifyDeviation(variationSpan, position);
    const insideVariation = (kind === 'extend' || kind === 'truncate') && variationSpan !== null;
    const startTurn = insideVariation ? variationSpan!.startTurn : position.turn;
    // Kept entries: forced interludes ride along with the turn they resolve —
    // keep them until the NEXT turn entry past the cut (mirrors alignHistoryRows).
    let keepTurns = insideVariation ? keptEntries(variationSpan!, position) : 0;
    const replayHistory: BranchHistoryEntry[] = [];
    for (const entry of history) {
      if (entry.kind !== 'forced') {
        if (keepTurns === 0) break;
        keepTurns -= 1;
      }
      replayHistory.push(entry);
    }
    // Turn-0 variation: startBranch needs leads — the caller's (fresh lead
    // branch) or the recorded lead entry's (truncation/refresh rebuild).
    if (startTurn === 0 && !leadOverride && !replayHistory[0]?.leadChoices) return;
    // Bring-limited replays (VGC 4 of 6): the interactive branch fields only
    // what the real game brought — the bring-all base format would otherwise
    // let evaluations and play-outs switch into never-brought Pokémon. The
    // T0 picker carries its own selection; fail-open when the protocol does
    // not pin every brought species.
    let bringOnly: { p1: string[]; p2: string[] } | undefined;
    if (bringCount !== null && startTurn > 0) {
      const p1Brought = broughtSpeciesFor(snapshots, 'p1');
      const p2Brought = broughtSpeciesFor(snapshots, 'p2');
      if (p1Brought.length === bringCount && p2Brought.length === bringCount) {
        bringOnly = { p1: p1Brought, p2: p2Brought };
      }
    }

    const abortController = new AbortController();
    branchAbortRef.current = abortController;
    setBranchPreparing(true);
    setBranchProgress(null);
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const { buildTeamsFromReplay } = await import('./lib/team-builder');
      const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, {
        userTeamText: teamText || undefined,
        p1Info: effectiveP1Info,
        p2Info: effectiveP2Info,
        usageStats: usageStats.stats,
        setAssumptions: setAssumptions.assumptions,
        inferredSpreads: await getInferredSpreads(),
        hpEvidence,
      });
      if (p1Team.length > 0 && p2Team.length > 0) {
        setBranchSession(session => session + 1);
        const { buildChoiceLockContext } = await import('./lib/choice-lock');
        const choiceLocks = buildChoiceLockContext(replayData.log, { p1Team, p2Team }, observations);
        const selectedSnapshot = snapshots.length > 0
          ? snapshots[Math.min(startTurn - 1, snapshots.length - 1)] ?? null
          : null;
        await startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, startTurn, selectedSnapshot, {
          replayHistory,
          p1Choices: prefill?.p1Choices ?? [],
          p2Choices: prefill?.p2Choices ?? [],
          playerNames: [replayData.players[0], replayData.players[1]],
          onProgress: (turn, target) => setBranchProgress({ turn, target }),
          abort: abortController.signal,
          snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
          choiceLocks,
          leadOverride,
          bringOnly,
        });
        if (!abortController.signal.aborted) {
          branchWindowOpenRef.current = true;
          const branchBattle = getBattle();
          if (branchBattle?.ended) {
            setBranchDivergence('The simulated replay diverged from the real game and already ended' +
              `${branchBattle.winner ? ` (${branchBattle.winner} won the simulated line)` : ''}: ` +
              'the guessed sets could not reproduce this position. Recommendations cannot be played out here; ' +
              'correcting items/moves via Edit Player/Opp is the common fix.');
          } else if (branchBattle && branchBattle.turn < startTurn) {
            setBranchDivergence(`The simulated replay wedged at turn ${branchBattle.turn} on the way to ` +
              `turn ${startTurn}: the guessed sets diverge from the real game before this position.`);
          } else {
            setBranchDivergence(null);
          }
          // The pointer lands where the sim now stands; the tip-follow effect
          // covers replayed histories (and the turn-0 lead entry, which is
          // seeded by startBranch), this covers the entry-less start.
          if (replayHistory.length === 0 && startTurn > 0) {
            setViewTurn(startTurn);
            setViewLine('main');
          }
        }
      }
    } finally {
      setBranchPreparing(false);
      setBranchProgress(null);
      branchAbortRef.current = null;
    }
  }, [replayData, branchPreparing, variationSpan, history, teamText, snapshots, bringCount, observations, hpEvidence, getInferredSpreads, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, startBranch, getBattle, setViewTurn]);

  const requestDeviation = useCallback((
    prefill: { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] } | null,
  ) => {
    // The ref, not the closure: see viewTurnRef (slider→click race).
    const position: TimelinePosition = { turn: viewTurnRef.current, line: viewLine };
    // The end snapshot is the post-battle sentinel, not a playable turn —
    // the old Branch-Here button was disabled here (B10/B12/G23).
    if (position.line === 'main' && endSnapshotTurn !== null && position.turn >= endSnapshotTurn) {
      setBranchDivergence('The battle is already over at the end position: pick an earlier turn to play from.');
      return;
    }
    const kind = classifyDeviation(variationSpan, position);
    const run = () => {
      // The overlay dies with the entries it belonged to.
      if (kind === 'replace' || kind === 'open') {
        setVariationScores([]);
      } else if (kind === 'truncate') {
        setVariationScores(previous => previous.map((value, index) => (index + 1 > position.turn ? null : value)));
      }
      void rebuildAt(position, prefill).then(() => {
        if (prefill) void executeTurn();
      });
    };
    if (kind === 'replace' && variationSpan) {
      const turnCount = variationSpan.length;
      setPendingConfirm({
        message: `You are on the main line (turn ${position.turn}): replace the existing variation ` +
          `from turn ${variationSpan.startTurn} (${turnCount} ${turnCount === 1 ? 'turn' : 'turns'})?`,
        proceed: () => { setPendingConfirm(null); run(); },
      });
      return;
    }
    run();
  }, [viewLine, variationSpan, rebuildAt, executeTurn, endSnapshotTurn]);

  /**
   * Turn-0 branching: replace the game's leads and play from team preview.
   * Same chess rules as any deviation — an existing variation is replaced
   * only after the confirm.
   */
  const startLeadVariation = useCallback((leads: { p1: string[]; p2: string[]; bring?: boolean }, opts?: { onStart?: () => void }) => {
    const run = () => {
      opts?.onStart?.();
      setVariationScores([]);
      void rebuildAt({ turn: 0, line: 'main' }, null, leads);
    };
    if (variationSpan) {
      const turnCount = variationSpan.length;
      setPendingConfirm({
        message: `Start a new game from turn 0: replace the existing variation ` +
          `from turn ${variationSpan.startTurn} (${turnCount} ${turnCount === 1 ? 'turn' : 'turns'})?`,
        proceed: () => { setPendingConfirm(null); run(); },
      });
      return;
    }
    run();
  }, [variationSpan, rebuildAt]);

  const handleCancelBranchPreparation = useCallback(() => {
    branchAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!pendingBranchRefresh || !replayData) return;

    let cancelled = false;
    const refreshRequest = pendingBranchRefresh;
    const activeReplay = replayData;

    async function refreshBranch() {
      const abortController = new AbortController();
      branchAbortRef.current = abortController;
      setBranchPreparing(true);
      setBranchProgress(null);
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        const { buildTeamsFromReplay } = await import('./lib/team-builder');
        const { p1Team, p2Team } = buildTeamsFromReplay(activeReplay.log, {
          userTeamText: teamText || undefined,
          p1Info: refreshRequest.p1Info,
          p2Info: refreshRequest.p2Info,
          usageStats: usageStats.stats,
          setAssumptions: setAssumptions.assumptions,
          inferredSpreads: await getInferredSpreads(refreshRequest.p1Info, refreshRequest.p2Info),
          hpEvidence,
        });
        if (!cancelled && p1Team.length > 0 && p2Team.length > 0) {
          setBranchSession(session => session + 1);
          const { buildChoiceLockContext } = await import('./lib/choice-lock');
          const choiceLocks = buildChoiceLockContext(activeReplay.log, { p1Team, p2Team }, observations);
          // The refresh rebuilds the VARIATION, wherever the pointer wanders —
          // its start turn, never the currently viewed position. Without a
          // live runtime (fresh hypothetical), the viewed turn IS the target.
          const refreshTurn = (branching ? variationStartTurn : null) ?? viewTurn;
          const refreshSnapshot = snapshots.length > 0
            ? snapshots[Math.min(refreshTurn - 1, snapshots.length - 1)] ?? null
            : null;
          // Bring-limited replays keep their trim through team-edit
          // refreshes too (a T0 variation re-seeds it from its lead entry).
          let refreshBringOnly: { p1: string[]; p2: string[] } | undefined;
          if (bringCount !== null && refreshTurn > 0) {
            const p1Brought = broughtSpeciesFor(snapshots, 'p1');
            const p2Brought = broughtSpeciesFor(snapshots, 'p2');
            if (p1Brought.length === bringCount && p2Brought.length === bringCount) {
              refreshBringOnly = { p1: p1Brought, p2: p2Brought };
            }
          }
          await startBranch(getBranchSimulatorFormat(activeReplay), p1Team, p2Team, activeReplay.log, refreshTurn, refreshSnapshot, {
            replayHistory: refreshRequest.history,
            p1Choices: refreshRequest.p1Choices,
            p2Choices: refreshRequest.p2Choices,
            playerNames: [activeReplay.players[0], activeReplay.players[1]],
            onProgress: (turn, target) => setBranchProgress({ turn, target }),
            abort: abortController.signal,
            snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
            choiceLocks,
            bringOnly: refreshBringOnly,
          });
          if (!abortController.signal.aborted) {
            branchWindowOpenRef.current = true;
          }
        }
      } finally {
        if (!cancelled) {
          setBranchPreparing(false);
          setBranchProgress(null);
          setPendingBranchRefresh(null);
        }
        branchAbortRef.current = null;
      }
    }

    void refreshBranch();
    return () => {
      cancelled = true;
    };
  }, [
    pendingBranchRefresh,
    replayData,
    getInferredSpreads,
    teamText,
    viewTurn,
    variationStartTurn,
    branching,
    snapshots,
    bringCount,
    usageStats.stats,
    setAssumptions.assumptions,
    observations,
    hpEvidence,
    startBranch,
  ]);

  const handleSetChoice = useCallback((side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => {
    if (!liveTip) {
      const slot = activeSlot ?? 0;
      setDraftChoices(previous => {
        const next = { p1: [...previous.p1], p2: [...previous.p2] };
        next[side][slot] = choice;
        return next;
      });
      return;
    }
    setChoice(side, choice, activeSlot);
  }, [liveTip, setChoice]);

  // ----- Position evaluation (singles + doubles) -----
  const replayGameType = useMemo(
    () => (replayData ? getReplayGameType(replayData.log) : null),
    [replayData],
  );

  /** T0 lead picker data: each side's team with the real leads marked (the
   *  pre-turn-1 snapshot's actives ARE the leads) and, for bring-limited
   *  formats, which Pokémon the real game brought (active in ANY snapshot). */
  const leadOptions = useMemo<{ p1: LeadOption[]; p2: LeadOption[] }>(() => {
    const snapshot = snapshots[0] ?? null;
    if (!snapshot) return { p1: [], p2: [] };
    const optionsOf = (side: typeof snapshot.p1, brought: Set<string>): LeadOption[] =>
      side.pokemon.map(pokemon => ({
        name: pokemon.name,
        species: pokemon.speciesForme,
        wasLead: pokemon.isActive,
        wasBrought: brought.has(pokemon.speciesForme),
      }));
    return {
      p1: optionsOf(snapshot.p1, new Set(broughtSpeciesFor(snapshots, 'p1'))),
      p2: optionsOf(snapshot.p2, new Set(broughtSpeciesFor(snapshots, 'p2'))),
    };
  }, [snapshots]);
  const evalAvailable = useMemo(
    () => !!replayData && (replayGameType === null || replayGameType === 'singles' || replayGameType === 'doubles'),
    [replayData, replayGameType],
  );

  /** The lead picker's default selection: the real game's leads, then the
   *  rest of its bring; unknown slots fill in option order (an engine run
   *  needs a complete selection even when the protocol reveals less). */
  const defaultLeadSelection = useCallback((): { p1: string[]; p2: string[]; bring?: boolean } => {
    const max = bringCount ?? (replayGameType === 'doubles' ? 2 : 1);
    const pick = (options: LeadOption[]) => [
      ...options.filter(option => option.wasLead),
      ...options.filter(option => !option.wasLead && option.wasBrought),
      ...options.filter(option => !option.wasLead && !option.wasBrought),
    ].slice(0, max).map(option => option.species);
    const leads = { p1: pick(leadOptions.p1), p2: pick(leadOptions.p2) };
    return bringCount !== null ? { ...leads, bring: true } : leads;
  }, [bringCount, replayGameType, leadOptions]);
  const evalIsDoubles = replayGameType === 'doubles';

  const setsFingerprint = useMemo(
    () => JSON.stringify([editedP1Info, editedP2Info, teamText]),
    [editedP1Info, editedP2Info, teamText],
  );

  // Tera resolution: 'auto' turns enumeration off when the game never
  // terastallized, and in draft/custom formats (per-Pokémon Tera rights)
  // restricts it to the species that actually did — a global switch would
  // recommend illegal Teras and price floors against impossible threats.
  const effectiveTera = useMemo(
    () => (replayData
      ? resolveTeraPreference(evaluation.prefs.tera, inferReplayFormatId(replayData), replayData.log)
      : false),
    [replayData, evaluation.prefs.tera],
  );

  // Sleep Clause resolution: the branch format carries it (declared |rule|
  // lines, or the singles default for rule-less logs) — the eval candidate
  // filter needs it as a flag because serialization strips custom rules.
  const effectiveSleepClause = useMemo(
    () => (replayData ? formatEnforcesSleepClause(getBranchSimulatorFormat(replayData)) : false),
    [replayData],
  );

  // Posted open team sheets, surfaced in the stats panel as 'sheet'
  // knowledge (the extraction needs the sim's Teams parser — lazy import).
  const [sheetTeams, setSheetTeams] = useState<{ p1: PokemonSet[] | null; p2: PokemonSet[] | null }>({ p1: null, p2: null });
  useEffect(() => {
    let stale = false;
    setSheetTeams({ p1: null, p2: null });
    if (!replayData) return;
    void import('./lib/team-builder').then(({ extractTeamSheets }) => {
      if (!stale) setSheetTeams(extractTeamSheets(replayData.log));
    });
    return () => { stale = true; };
  }, [replayData]);
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

  // Guessed-item mons + their usage-plausible alternatives — the search
  // space for the sensitivity probes (flagged-verdict honesty).
  const sensitivityTargetsFor = useCallback((side: 'p1' | 'p2'): SensitivityTarget[] => {
    const info = side === 'p1' ? statsP1Info : statsP2Info;
    if (!info) return [];
    return info.pokemon
      .filter(mon => mon.item.source === 'guessed' && mon.item.value)
      .map(mon => ({
        species: mon.species,
        items: alternativeItems(usageStats.stats, mon.species, mon.item.value, mon.ruledOut),
      }))
      .filter(target => target.items.length > 0);
  }, [statsP1Info, statsP2Info, usageStats.stats]);

  const acquireBranchPosition = useCallback(async () => {
    const battle = getBattle();
    if (!battle) throw new Error('No live branch battle to evaluate.');
    const { serializeLiveBattle } = await import('./lib/eval/serialize');
    return serializeLiveBattle(battle);
  }, [getBattle]);

  /**
   * Exact main-line positions the app has already reconstructed, keyed like
   * the eval cache (replay:turn:sets). In the unified timeline exactness is
   * the app's job, not a button: every acquisition (Evaluate, Analyze game's
   * streamed boundaries, the dwell rebuild below) lands here, and the pickers
   * upgrade from approximate to exact the moment a position is known.
   */
  const exactPositionsRef = useRef(new Map<string, string>());
  const failedExactRef = useRef(new Set<string>());
  const [exactPositionsVersion, setExactPositionsVersion] = useState(0);
  const exactKeyFor = useCallback(
    (turn: number) => (replayData ? `${replayData.id}:${turn}:${setsFingerprint}` : null),
    [replayData, setsFingerprint],
  );
  const storeExactPosition = useCallback((turn: number, serialized: string) => {
    const key = exactKeyFor(turn);
    if (!key || exactPositionsRef.current.get(key) === serialized) return;
    exactPositionsRef.current.set(key, serialized);
    setExactPositionsVersion(version => version + 1);
  }, [exactKeyFor]);
  useEffect(() => {
    // New replay or new set knowledge: yesterday's reconstructions no longer
    // describe these positions (keys differ, but the memory should go too).
    exactPositionsRef.current.clear();
    failedExactRef.current.clear();
    setExactPositionsVersion(version => version + 1);
  }, [replayData?.id, setsFingerprint]);

  const makeReplayAcquire = useCallback((turn: number) =>
    async (reportReconstruct: (turn: number, target: number) => void) => {
      if (!replayData) throw new Error('Load a replay first.');
      const { buildTeamsFromReplay } = await import('./lib/team-builder');
      const branchEngine = await import('./lib/branch-engine');
      const { serializeLiveBattle } = await import('./lib/eval/serialize');
      const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, {
        userTeamText: teamText || undefined,
        p1Info: effectiveP1Info,
        p2Info: effectiveP2Info,
        usageStats: usageStats.stats,
        setAssumptions: setAssumptions.assumptions,
        inferredSpreads: await getInferredSpreads(),
        hpEvidence,
      });
      if (p1Team.length === 0 || p2Team.length === 0) throw new Error('Could not build both teams for this replay.');
      const { buildChoiceLockContext } = await import('./lib/choice-lock');
      const runtime = await branchEngine.reconstructBranchRuntime({
        format: getBranchSimulatorFormat(replayData),
        p1Team,
        p2Team,
        replayLog: replayData.log,
        targetTurn: turn,
        snapshot: snapshots.length > 0 ? snapshots[Math.min(turn - 1, snapshots.length - 1)] : null,
        playerNames: [replayData.players[0], replayData.players[1]],
        onProgress: reportReconstruct,
        choiceLocks: buildChoiceLockContext(replayData.log, { p1Team, p2Team }, observations),
        // The sweep's healing, on the single-turn path too: per-turn
        // boundary corrections keep a diverging choice replay in lockstep
        // with the protocol, so the cascade zone (draft t56+) arrives LIVE
        // instead of prematurely ended — this is what re-enabled the
        // think-deeper button (the 2026-08-11 hide).
        capturePositions: {
          snapshotFor: boundary => snapshots[Math.min(boundary - 1, snapshots.length - 1)] ?? null,
          onPosition: () => {},
        },
      });
      const invalid = branchEngine.validateBranchRuntime(runtime);
      if (invalid) throw new Error(invalid);
      const battle = runtime.battleStream.battle;
      if (!battle) throw new Error('Reconstruction produced no battle.');
      // Backstop for replays healing cannot save: an ended (or short)
      // arrival is a divergence artifact, and evaluating it would report a
      // decided ±1.00 — the "think deeper dropped the position to 100%"
      // report. Fail loudly instead of publishing a phantom number.
      if (!branchEngine.reconstructionReached(runtime, turn)) {
        throw new Error(`The reconstruction diverged before turn ${turn}: the guessed sets could not reproduce this position. Correcting items/moves via Edit Player/Opp is the common fix.`);
      }
      const serialized = serializeLiveBattle(battle);
      storeExactPosition(turn, serialized);
      return serialized;
    }, [replayData, teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, snapshots, observations, hpEvidence, getInferredSpreads, storeExactPosition]);

  // Per-block seed/residual records of the last sweep reconstruction —
  // instrumentation only (debug handle + drift report), never verdicts.
  const [sweepAlignment, setSweepAlignment] = useState<TurnAlignmentRecord[] | null>(null);

  // Single-pass sweep acquisition: one reconstruction captures every turn
  // boundary, instead of one O(turn) replay per turn (quadratic polling).
  const makeSweepAcquireAll = useCallback((turns: number) =>
    async (
      report: (turn: number, target: number) => void,
      onPosition?: (turn: number, serialized: string) => void,
      onDiagnostic?: (message: string) => void,
    ): Promise<(string | null)[]> => {
      if (!replayData) throw new Error('Load a replay first.');
      setSweepAlignment(null);
      const { buildTeamsFromReplay } = await import('./lib/team-builder');
      const branchEngine = await import('./lib/branch-engine');
      const { serializeLiveBattle } = await import('./lib/eval/serialize');
      const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, {
        userTeamText: teamText || undefined,
        p1Info: effectiveP1Info,
        p2Info: effectiveP2Info,
        usageStats: usageStats.stats,
        setAssumptions: setAssumptions.assumptions,
        inferredSpreads: await getInferredSpreads(),
        hpEvidence,
      });
      if (p1Team.length === 0 || p2Team.length === 0) throw new Error('Could not build both teams for this replay.');
      const { buildChoiceLockContext } = await import('./lib/choice-lock');
      const positions: (string | null)[] = new Array(turns).fill(null);
      const runtime = await branchEngine.reconstructBranchRuntime({
        format: getBranchSimulatorFormat(replayData),
        p1Team,
        p2Team,
        replayLog: replayData.log,
        targetTurn: turns,
        snapshot: snapshots.length > 0 ? snapshots[Math.min(turns - 1, snapshots.length - 1)] : null,
        playerNames: [replayData.players[0], replayData.players[1]],
        onProgress: report,
        choiceLocks: buildChoiceLockContext(replayData.log, { p1Team, p2Team }, observations),
        capturePositions: {
          snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
          onPosition: (turn, battle) => {
            if (turn > turns) return;
            try {
              const serialized = serializeLiveBattle(battle);
              positions[turn - 1] = serialized;
              storeExactPosition(turn, serialized);
              onPosition?.(turn, serialized);
            } catch {
              // A broken boundary becomes a graph gap, not a failed sweep.
            }
          },
        },
      });
      // The boundary captures above already delivered every turn the replay
      // reached; this final store only covers the target turn itself — and
      // only when the reconstruction ARRIVED there live. A diverged run that
      // cascaded into an early end would otherwise be stored as the last
      // turn's position and scored as a decided ±1: one phantom point at the
      // far right with every other turn a gap (the empty-graph report).
      setSweepAlignment(runtime.haxAlignment);
      const finalBattle = runtime.battleStream.battle;
      if (finalBattle?.ended && finalBattle.turn < turns) {
        onDiagnostic?.(
          `The simulated battle ended at turn ${finalBattle.turn} although the real game continued: ` +
          `no candidate seed avoided the divergence, so later turns have no positions.`,
        );
      }
      const invalid = branchEngine.validateBranchRuntime(runtime);
      const battle = runtime.battleStream.battle;
      if (!invalid && battle && branchEngine.reconstructionReached(runtime, turns)) {
        const serialized = serializeLiveBattle(battle);
        positions[turns - 1] = serialized;
        storeExactPosition(turns, serialized);
        onPosition?.(turns, serialized);
      }
      return positions;
    }, [replayData, teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, snapshots, observations, hpEvidence, getInferredSpreads, storeExactPosition]);

  const acquireReplayPosition = useMemo(() => makeReplayAcquire(viewTurn), [makeReplayAcquire, viewTurn]);

  /**
   * Picker state for the viewed position when the live sim is elsewhere
   * (variant B): exact from the recorded position where one exists, else
   * approximate from snapshot + guessed teams. Live-tip positions render
   * the sim's own state and skip this entirely.
   */
  const [positionPicker, setPositionPicker] = useState<{ simState: BranchSimState; source: PickerSource } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (liveTip) {
      setPositionPicker(null);
      return;
    }
    const exactMainLine = !viewingVariation && exactKeyFor(viewTurn)
      ? exactPositionsRef.current.get(exactKeyFor(viewTurn)!) ?? null
      : null;
    const stored = viewingVariation
      ? serializedAtView
      : (viewTurn === variationStartTurn ? startSerialized : null) ?? exactMainLine;
    (async () => {
      if (stored) {
        const { pickerStateFromSerialized } = await import('./lib/picker-state');
        try {
          const state = await pickerStateFromSerialized(stored);
          if (!cancelled) setPositionPicker({ simState: state, source: 'stored' });
          return;
        } catch {
          // Fall through to the snapshot approximation.
        }
      }
      if (viewingVariation) {
        // A variation position without a usable capture has no snapshot
        // either — the pickers stay empty until a rebuild passes through.
        if (!cancelled) setPositionPicker(null);
        return;
      }
      const snapshot = snapshots[Math.min(viewTurn - 1, snapshots.length - 1)] ?? null;
      if (!snapshot || !replayData) {
        if (!cancelled) setPositionPicker(null);
        return;
      }
      const [{ buildTeamsFromReplay }, { pickerStateFromSnapshot }] = await Promise.all([
        import('./lib/team-builder'),
        import('./lib/picker-state'),
      ]);
      const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, {
        userTeamText: teamText || undefined,
        p1Info: effectiveP1Info,
        p2Info: effectiveP2Info,
        usageStats: usageStats.stats,
        setAssumptions: setAssumptions.assumptions,
        inferredSpreads: await getInferredSpreads(),
        hpEvidence,
      });
      if (!cancelled) setPositionPicker({ simState: pickerStateFromSnapshot(snapshot, p1Team, p2Team, replayGenNumber), source: 'snapshot' });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    liveTip, viewingVariation, serializedAtView, variationStartTurn, startSerialized, viewTurn, snapshots, replayData,
    teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, getInferredSpreads, hpEvidence,
    replayGenNumber, exactKeyFor, exactPositionsVersion,
  ]);

  const handleEvaluate = useCallback(() => {
    if (!replayData) return;
    if (liveTip) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, acquire: acquireBranchPosition, tag: evalViewKey });
    } else if (viewingVariation && serializedAtView) {
      // A recorded variation position: acquisition is instant — the search
      // itself still runs at the configured settings.
      const stored = serializedAtView;
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, acquire: async () => stored, tag: evalViewKey });
    } else {
      evaluation.evaluate({
        cacheKey: `${replayData.id}:${viewTurn}:${setsFingerprint}`,
        tera: effectiveTera,
        sleepClause: effectiveSleepClause,
        acquire: acquireReplayPosition,
        tag: evalViewKey,
      });
    }
  }, [replayData, liveTip, viewingVariation, serializedAtView, evaluation, effectiveTera, effectiveSleepClause, acquireBranchPosition, acquireReplayPosition, viewTurn, setsFingerprint, evalViewKey]);

  // Every eval finishing while the pointer sits on the variation feeds the
  // graph overlay — auto-evals after executed turns included. The tag guard
  // keeps a run that finished after a navigation from landing in the wrong
  // turn's slot (the score belongs to the position it was STARTED at).
  useEffect(() => {
    if (evaluation.status !== 'done' || !evaluation.result || !viewingVariation) return;
    if (evaluation.resultTag !== null && evaluation.resultTag !== evalViewKey) return;
    const score = evaluation.result.score;
    setVariationScores(previous => {
      const next = [...previous];
      next[viewTurn - 1] = score;
      return next;
    });
  }, [evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, viewingVariation, viewTurn]);

  /** Non-live positions render the resolved picker state with the DRAFT
   *  choices mirrored in — the panel's selection logic reads simState. */
  const pickerSimState = useMemo(() => (positionPicker ? {
    ...positionPicker.simState,
    p1Choice: draftChoices.p1[0] ?? null,
    p1Choices: draftChoices.p1,
    p2Choice: draftChoices.p2[0] ?? null,
    p2Choices: draftChoices.p2,
  } : null), [positionPicker, draftChoices]);

  const handleExecuteDraft = useCallback(() => {
    requestDeviation({ p1Choices: draftChoices.p1, p2Choices: draftChoices.p2 });
  }, [requestDeviation, draftChoices]);

  /**
   * What the viewed line actually played at this position — the answer to
   * "which move did they press here?". Main line: the replay protocol's
   * action for this turn. Variation (behind the tip): the recorded entry's
   * choices. The tip itself has no played move yet.
   */
  const playedAtView = useMemo<{ p1: PlayedPick | null; p2: PlayedPick | null } | null>(() => {
    const fromAction = (action: { kind: 'move' | 'switch'; name: string; species?: string } | null): PlayedPick | null =>
      action ? { kind: action.kind, name: action.name, ...(action.species ? { species: action.species } : {}) } : null;
    if (viewingVariation && variationSpan) {
      const index = viewTurn - variationSpan.startTurn;
      let count = 0;
      for (const entry of history) {
        if (entry.kind === 'forced') continue;
        if (count === index) {
          const fromSlots = (slots: (BranchSlotChoice | null)[] | undefined): PlayedPick | null => {
            const first = (slots ?? []).find(Boolean) ?? null;
            if (!first) return null;
            return first.kind === 'move'
              ? { kind: 'move', name: first.moveName }
              : { kind: 'switch', name: first.pokemonName, species: first.speciesId };
          };
          return { p1: fromSlots(entry.p1SlotChoices), p2: fromSlots(entry.p2SlotChoices) };
        }
        count += 1;
      }
      return null;
    }
    const lines = snapshots[viewTurn]?.log;
    if (!lines || lines.length === 0) return null;
    const turn = evalIsDoubles ? parsePlayedActionsDoubles(lines) : parsePlayedActions(lines);
    if (!turn.p1 && !turn.p2) return null;
    return { p1: fromAction(turn.p1), p2: fromAction(turn.p2) };
  }, [viewingVariation, variationSpan, viewTurn, history, snapshots, evalIsDoubles]);

  // Clicking a recommended choice pre-fills the branch pickers.
  const applyEvalChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice): boolean => {
    if (!simState) return false;
    const movesBySlot = side === 'p1' ? simState.p1MovesBySlot : simState.p2MovesBySlot;
    const switchesBySlot = side === 'p1' ? simState.p1SwitchesBySlot : simState.p2SwitchesBySlot;
    // The engine's choice string carries one part per slot WITH choices —
    // a doubles forced replacement is a single part that belongs to the
    // forced slot, so the mask aligns parts with the request's slots.
    const activeSlots = side === 'p1' ? simState.p1ActiveSlots : simState.p2ActiveSlots;
    const forcedSlots = side === 'p1' ? simState.p1ForceSwitches : simState.p2ForceSwitches;
    const mask = requiredChoicesForActiveSlots(
      activeSlots.map(active => (active ? { fainted: active.fainted } : null)),
      forcedSlots,
    );
    const slotChoices = evalChoiceToSlotChoices(ranked.choice, movesBySlot, switchesBySlot, ranked.label, mask);
    if (!slotChoices) return false;
    let applied = false;
    slotChoices.forEach((choice, activeSlot) => {
      if (!choice) return;
      handleSetChoice(side, choice, activeSlot);
      applied = true;
    });
    return applied;
  }, [simState, handleSetChoice]);

  // Armed by a clicked engine line whose turn executed — see the interlude
  // completion effect below.
  const walkInterludeRef = useRef(false);
  const walkProcessedRef = useRef<EvalResult | null>(null);

  // Chess-style walk: clicking an engine line PLAYS THE TURN OUT — the
  // clicked side commits its line, the other side answers with the engine's
  // top reply, the turn executes, and the result re-evaluates so the next
  // recommendations are already waiting for the next click.
  const playOutEvalChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply: RankedChoice | null) => {
    // A diverged/finished branch sim cannot accept choices — refuse with the
    // divergence notice instead of letting the sim reject confusingly.
    if (getBattle()?.ended) {
      setBranchDivergence(previous => previous ??
        'The simulated replay already ended; recommendations cannot be played out in this diverged line.');
      return;
    }
    if (!applyEvalChoice(side, ranked)) return;
    const other = side === 'p1' ? 'p2' : 'p1';
    // The top reply can fail to map onto the live pickers (label/slot
    // mismatches) — walking down the ranked list keeps the click playing a
    // full turn instead of silently stalling on a prefilled half-choice.
    const replies = [
      ...(reply ? [reply] : []),
      ...(evaluation.result?.perSide[other] ?? []),
    ].filter(candidate => candidate.choice !== 'wait');
    for (const candidate of replies) {
      if (applyEvalChoice(other, candidate)) {
        // Mid-turn KOs pause the sim on a forced replacement — the walk
        // finishes those interludes with the engine's answer (effect below).
        walkInterludeRef.current = true;
        void executeTurn().then(() => handleEvaluate());
        return;
      }
    }
    // No engine reply to commit (forced-switch positions execute through
    // setChoice on their own) — show the engine's view of what stands.
    handleEvaluate();
  }, [applyEvalChoice, executeTurn, handleEvaluate, getBattle, evaluation.result]);

  const [pendingEvalPick, setPendingEvalPick] =
    useState<{ side: 'p1' | 'p2'; ranked: RankedChoice; reply: RankedChoice | null } | null>(null);

  const handleExploreChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply?: RankedChoice | null) => {
    // The walk re-evaluates after every executed turn — surface that as the
    // visible Auto setting rather than a hidden mode.
    if (!evaluation.prefs.auto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
    if (liveTip && simState) {
      playOutEvalChoice(side, ranked, reply ?? null);
      return;
    }
    // Any other position: the deviation flow rebuilds the sim there (chess
    // rules incl. the replace confirm) and the pending pick plays out once
    // the pointer sits on the live tip again.
    setPendingEvalPick({ side, ranked, reply: reply ?? null });
    requestDeviation(null);
  }, [liveTip, simState, playOutEvalChoice, requestDeviation, evaluation]);

  // A matrix cell names BOTH sides' choices — play exactly that pair out
  // (draft T48: "what would Shadow Ball into Knock Off look like?").
  const handlePickPair = useCallback((p1: { choice: string; label: string }, p2: { choice: string; label: string }) => {
    const rankedLike = (entry: { choice: string; label: string }): RankedChoice =>
      ({ choice: entry.choice, label: entry.label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
    handleExploreChoice('p1', rankedLike(p1), rankedLike(p2));
  }, [handleExploreChoice]);

  useEffect(() => {
    if (!pendingEvalPick) return;
    // Wait until the rebuild landed the pointer ON the live sim — applying
    // earlier would play the pick into whatever position the OLD sim held.
    if (liveTip && simState && !branchPreparing && pendingConfirm === null) {
      playOutEvalChoice(pendingEvalPick.side, pendingEvalPick.ranked, pendingEvalPick.reply);
      setPendingEvalPick(null);
    } else if (!branching && !branchPreparing && pendingConfirm === null) {
      // Branch entry failed or was cancelled — drop the stale pick.
      setPendingEvalPick(null);
    }
  }, [pendingEvalPick, liveTip, simState, branching, branchPreparing, pendingConfirm, playOutEvalChoice]);

  // ── "Let it play out": the engine plays BOTH sides' top choice from the
  // current position until the game ends, the user stops, or the safety cap
  // trips. Each executed turn is a normal history entry — navigable,
  // evaluable, truncatable like anything else; Stop keeps what was played.
  const [playOut, setPlayOut] = useState<{ active: boolean; executed: number; turns: number; startTurn: number; prevAuto: boolean } | null>(null);
  /** Why the last play-out ended + where watching it starts (panel notice). */
  const [playOutNotice, setPlayOutNotice] = useState<{ text: string; watchTurn: number } | null>(null);
  const playOutProcessedRef = useRef<EvalResult | null>(null);

  /**
   * Chess-walk interlude completion: after a clicked engine line executes,
   * a mid-turn KO leaves the sim waiting on a forced replacement — without
   * this the "play the turn out" click visibly stopped halfway through the
   * turn. While armed, one-sided positions (only forced replacements rank —
   * the other side 'wait's) auto-play the engine's top answer; the first
   * two-sided position is the next real decision point and disarms the walk.
   */
  useEffect(() => {
    if (!walkInterludeRef.current || playOut?.active) return;
    if (!liveTip || executing || branchPreparing) return;
    if (evaluation.status !== 'done' || !evaluation.result) return;
    if (evaluation.resultTag !== null && evaluation.resultTag !== evalViewKey) return;
    if (walkProcessedRef.current === evaluation.result) return;
    walkProcessedRef.current = evaluation.result;
    const battle = getBattle();
    if (!battle || battle.ended) {
      walkInterludeRef.current = false;
      return;
    }
    const p1 = evaluation.result.perSide.p1.find(choice => choice.choice !== 'wait') ?? null;
    const p2 = evaluation.result.perSide.p2.find(choice => choice.choice !== 'wait') ?? null;
    if (p1 && p2) {
      walkInterludeRef.current = false;
      return;
    }
    const single = p1 ? { side: 'p1' as const, choice: p1 } : p2 ? { side: 'p2' as const, choice: p2 } : null;
    if (!single || !applyEvalChoice(single.side, single.choice)) {
      walkInterludeRef.current = false;
      return;
    }
    // setChoice auto-executes forced replacements; the auto pref re-evaluates
    // once the entry lands, which re-enters this effect until two-sided.
  }, [playOut?.active, liveTip, executing, branchPreparing, evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, getBattle, applyEvalChoice]);

  /** Seek the branch frame to the play-out's start and let it play — the
   *  point of the feature: watch how the game runs on from your move. The
   *  pointer moves to the tip (so the branch frame is the one on screen and
   *  the next choice stays at hand) while the movie starts at `turn`. */
  const watchFrom = useCallback((turn: number) => {
    if (tipTurn !== null) navigateTo({ turn: tipTurn, line: 'variation' }, { seek: false, internal: true });
    window.setTimeout(() => {
      setNavSeek(prev => ({ turn, seq: (prev?.seq ?? 0) + 1, play: true }));
    }, 250);
  }, [navigateTo, tipTurn]);

  const startPlayOut = useCallback(() => {
    // Turn 0: the run INCLUDES the lead decision. Branching at the shared
    // turn-1 prefix instead produced a variation without its turn 0 — the
    // moves list started at turn 1 and viewing turn 1 fell back to the main
    // line (coverage begins one turn after the branch point).
    if (viewT0) {
      const arm = () => {
        const prevAuto = evaluation.prefs.auto;
        if (!prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
        playOutProcessedRef.current = null;
        setPlayOutNotice(null);
        setPlayOut({ active: true, executed: 0, turns: 0, startTurn: 1, prevAuto });
      };
      if (variationSpan?.startTurn === 0) {
        // A lead variation stands: keep its turn-0 decision, cut the tail
        // (the chess truncate), and let the engine play the game again.
        arm();
        setVariationScores(previous => previous.map((value, index) => (index + 1 > 1 ? null : value)));
        void rebuildAt({ turn: 1, line: 'variation' }, null);
        return;
      }
      // No lead variation yet: seed one with the picker's default (the real
      // game's leads and bring). The replace-confirm still guards an
      // existing variation — arming waits for the user's yes.
      startLeadVariation(defaultLeadSelection(), { onStart: arm });
      return;
    }
    // The post-battle sentinel has nothing to play — surface the existing
    // refusal instead of arming a loop that can never start.
    if (!liveTip && !viewingVariation && atEndPosition) {
      requestDeviation(null);
      return;
    }
    // Same gates as any deviation: rebuild to here first when the live sim
    // stands elsewhere (incl. the replace confirm on the main line).
    if (!liveTip) requestDeviation(null);
    const prevAuto = evaluation.prefs.auto;
    // The loop advances on completed evals — auto keeps them coming after
    // forced interludes; the user's own setting is restored at the end.
    if (!prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
    playOutProcessedRef.current = null;
    setPlayOutNotice(null);
    setPlayOut({ active: true, executed: 0, turns: 0, startTurn: viewTurn, prevAuto });
    if (liveTip) handleEvaluate();
  }, [viewT0, variationSpan, rebuildAt, startLeadVariation, defaultLeadSelection, liveTip, viewingVariation, atEndPosition, requestDeviation, evaluation, handleEvaluate, viewTurn]);

  const finishPlayOut = useCallback((current: NonNullable<typeof playOut>, text: string, opts?: { returnToStart?: boolean }) => {
    if (!current.prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: false });
    playOutRef.current = null;
    setPlayOut(null);
    setPlayOutNotice({ text, watchTurn: current.startTurn });
    // The engine's play dragged the pointer along to the tip; hand the view
    // back to the turn the run started from — the user replays the line
    // from there themselves (the Watch button, or just pressing play).
    if ((opts?.returnToStart ?? true) && current.turns > 0) {
      navigateTo({ turn: current.startTurn, line: 'variation' }, { seek: true, internal: true });
    }
  }, [evaluation, navigateTo]);

  const stopPlayOut = useCallback((opts?: { returnToStart?: boolean }) => {
    if (playOut) {
      finishPlayOut(playOut, `Play-out stopped: ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'} played (they stay in the variation).`, opts);
    }
  }, [playOut, finishPlayOut]);

  // Keep the render-independent mirrors in sync (navigateTo reads them —
  // it is declared before the play-out state exists).
  playOutRef.current = playOut;
  stopPlayOutRef.current = stopPlayOut;

  /**
   * A play-out started from the MAIN LINE arms before its rebuild finishes —
   * startPlayOut cannot evaluate a sim that does not exist yet, and entering
   * branch mode resets the eval to 'idle', which the auto-eval effect (stale
   * only) never picks up. Without this kick the loop showed "0 turns played"
   * forever. Fires once the live tip stands and no evaluation is in flight.
   */
  useEffect(() => {
    if (!playOut?.active || !liveTip || executing || branchPreparing) return;
    if (liveEvalStatus !== 'idle' && liveEvalStatus !== 'stale') return;
    handleEvaluate();
  }, [playOut?.active, liveTip, executing, branchPreparing, liveEvalStatus, handleEvaluate]);

  useEffect(() => {
    if (!playOut?.active || !liveTip || executing || branchPreparing) return;
    if (evaluation.status !== 'done' || !evaluation.result) return;
    // A result finished for another position (navigation race, pre-play-out
    // leftovers) must never be played from here — the tip's own eval follows.
    if (evaluation.resultTag !== null && evaluation.resultTag !== evalViewKey) return;
    if (playOutProcessedRef.current === evaluation.result) return;
    playOutProcessedRef.current = evaluation.result;
    const step = nextPlayOutStep(evaluation.result, getBattle()?.ended ?? false, playOut.executed);
    if (step.kind === 'done') {
      finishPlayOut(playOut, playOutDoneText(step.reason, playOut.turns));
      return;
    }
    if (step.kind === 'pair') {
      if (!applyEvalChoice('p1', step.p1) || !applyEvalChoice('p2', step.p2)) {
        finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the engine's choice was not playable at this position.`);
        return;
      }
      setPlayOut({ ...playOut, executed: playOut.executed + 1, turns: playOut.turns + 1 });
      void executeTurn().then(() => handleEvaluate());
      return;
    }
    // Single (forced) side: setChoice auto-executes forced replacements and
    // the auto pref re-evaluates once the entry lands. Counts as a step for
    // the safety cap, not as a played turn.
    if (!applyEvalChoice(step.side, step.choice)) {
      finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the forced replacement could not be submitted.`);
      return;
    }
    setPlayOut({ ...playOut, executed: playOut.executed + 1 });
  }, [playOut, liveTip, executing, branchPreparing, evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, getBattle, applyEvalChoice, executeTurn, handleEvaluate, finishPlayOut]);

  /**
   * The loop advances on COMPLETED evaluations — an evaluation that fails
   * (worker error, reconstruction refusal) used to leave "Engine is
   * playing…" stuck forever with no message. End the run with its reason.
   */
  useEffect(() => {
    if (!playOut?.active || executing || branchPreparing) return;
    if (evaluation.status !== 'error') return;
    finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the evaluation failed here${evaluation.error ? ` (${evaluation.error})` : ''}.`);
  }, [playOut, executing, branchPreparing, evaluation.status, evaluation.error, finishPlayOut]);

  /**
   * The unified timeline's exactness promise, without a button: when the
   * pointer DWELLS on a main-line turn whose exact position is unknown, the
   * app quietly reconstructs it in the background (the same healed path
   * Evaluate acquires through) and the pickers upgrade in place. Scrubbing
   * stays free — the timer only fires once the user settles, and never while
   * the sim, an evaluation, or a play-out is busy.
   */
  const [exactAcquiringTurn, setExactAcquiringTurn] = useState<number | null>(null);
  const exactAcquireBusyRef = useRef(false);
  useEffect(() => {
    if (!replayData || liveTip || viewingVariation || atEndPosition) return;
    if (usageStats.loading || setAssumptions.loading) return;
    if (executing || branchPreparing || playOut?.active) return;
    if (evaluation.status === 'reconstructing' || evaluation.status === 'searching' || evaluation.graph.running) return;
    const key = exactKeyFor(viewTurn);
    if (!key || exactPositionsRef.current.has(key) || failedExactRef.current.has(key)) return;
    const turn = viewTurn;
    const timer = window.setTimeout(() => {
      if (exactAcquireBusyRef.current) return;
      exactAcquireBusyRef.current = true;
      setExactAcquiringTurn(turn);
      void makeReplayAcquire(turn)(() => {})
        .catch(() => {
          // The approximation stays usable — the sim still validates on
          // execute. Remember the failure so a diverging replay does not
          // re-run the reconstruction on every render tick.
          failedExactRef.current.add(key);
        })
        .finally(() => {
          exactAcquireBusyRef.current = false;
          setExactAcquiringTurn(current => (current === turn ? null : current));
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    replayData, liveTip, viewingVariation, atEndPosition, viewTurn, exactKeyFor, exactPositionsVersion,
    usageStats.loading, setAssumptions.loading, executing, branchPreparing, playOut?.active,
    evaluation.status, evaluation.graph.running, makeReplayAcquire,
  ]);

  // The sweep counts PLAYED turns. The end snapshot (lastTurn + 1, the
  // post-game state) is the branch slider's "End" sentinel, not a turn —
  // counting it made the sweep chase a final position that cannot exist
  // and report "67 of 68 turns reconstructed" on a faithful replay. The
  // final played turn itself still analyzes like any other turn: its
  // actions live in the trailing block, which playedFor reads (GPL).
  const analyzableTurns = useMemo(
    () => (snapshots.length > 0 ? finalPlayedTurn(snapshots) : 1),
    [snapshots],
  );

  const handleAnalyzeGame = useCallback(() => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      cacheKeyFor: turn => `${replayData.id}:${turn}:${setsFingerprint}`,
      acquireFor: makeReplayAcquire,
      acquireAll: makeSweepAcquireAll(analyzableTurns),
      // snapshots[turn] carries the block ENDING at |turn|turn+1 — i.e. the
      // actions actually played on `turn`. Doubles logs carry two actions
      // per side and use the per-slot parser.
      playedFor: turn => (evalIsDoubles
        ? parsePlayedActionsDoubles(snapshots[turn]?.log ?? [])
        : parsePlayedActions(snapshots[turn]?.log ?? [])),
      // Turn 0: the lead decision at team preview.
      acquirePreview: async () => {
        const { buildTeamsFromReplay } = await import('./lib/team-builder');
        const branchEngine = await import('./lib/branch-engine');
        const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, {
          userTeamText: teamText || undefined,
          p1Info: effectiveP1Info,
          p2Info: effectiveP2Info,
          usageStats: usageStats.stats,
          setAssumptions: setAssumptions.assumptions,
          inferredSpreads: await getInferredSpreads(),
          hpEvidence,
        });
        if (p1Team.length === 0 || p2Team.length === 0) return null;
        return branchEngine.serializePreviewPosition(getBranchSimulatorFormat(replayData), p1Team, p2Team);
      },
      playedLeads: parseLeadSpecies(replayData.log),
      sensitivityTargetsFor,
    });
  }, [
    replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, setsFingerprint, makeReplayAcquire,
    makeSweepAcquireAll, snapshots, getInferredSpreads, evalIsDoubles, teamText, effectiveP1Info, effectiveP2Info,
    usageStats.stats, setAssumptions.assumptions, hpEvidence, sensitivityTargetsFor,
  ]);

  /**
   * "Always on": with the autoAnalyze pref set, Analyze game starts by
   * itself once a replay (and its Smogon data) is ready — the game graph and
   * report are simply there. One attempt per replay + set knowledge + Tera
   * resolution; a failed sweep does not retry-loop (Re-analyze stays manual).
   */
  const autoAnalyzeAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!evaluation.prefs.autoAnalyze || !replayData || !evalAvailable) return;
    if (usageStats.loading || setAssumptions.loading) return;
    if (snapshots.length === 0) return;
    if (evaluation.graph.running || evaluation.graph.scores.some(score => score !== null)) return;
    const key = `${replayData.id}:${setsFingerprint}:${JSON.stringify(effectiveTera)}`;
    if (autoAnalyzeAttemptRef.current === key) return;
    autoAnalyzeAttemptRef.current = key;
    handleAnalyzeGame();
  }, [
    evaluation.prefs.autoAnalyze, replayData, evalAvailable, usageStats.loading, setAssumptions.loading,
    snapshots.length, evaluation.graph.running, evaluation.graph.scores, setsFingerprint, effectiveTera, handleAnalyzeGame,
  ]);

  // Explains ONE turn: a two-turn mini sweep (turn + its follow-up) so the
  // report can price the played outcome. Runs ONLY from the explicit deepen
  // button — selecting a turn shows the stored result and never re-searches
  // (silent score swaps read as disagreement between the report and the
  // turn view).
  const analyzeTurnNow = useCallback((turn: number, settings?: TurnEvalSettings) => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      from: turn,
      to: Math.min(turn + 1, analyzableTurns),
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      cacheKeyFor: sweepTurn => `${replayData.id}:${sweepTurn}:${setsFingerprint}`,
      acquireFor: makeReplayAcquire,
      playedFor: sweepTurn => (evalIsDoubles
        ? parsePlayedActionsDoubles(snapshots[sweepTurn]?.log ?? [])
        : parsePlayedActions(snapshots[sweepTurn]?.log ?? [])),
      sensitivityTargetsFor,
      settings,
    });
  }, [replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, setsFingerprint, makeReplayAcquire, snapshots, evalIsDoubles, sensitivityTargetsFor]);

  // Any position change invalidates a displayed result.
  const { markStale: markEvalStale, reset: resetEval, clearGraph } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [viewTurn, viewLine, history.length, editedP1Info, editedP2Info, markEvalStale]);

  // A different replay or entering/leaving branch mode is a new position context.
  useEffect(() => {
    resetEval();
  }, [replayData?.id, branching, resetEval]);

  // The graph is tied to a specific replay + set knowledge + Tera mode.
  // The SELECTION survives the reset — analysisTurn mirrors the slider and
  // simply has nothing to show until fresh data arrives (nulling it here
  // raced the mirror effect whenever usage stats landed after load, leaving
  // the merged panel permanently empty).
  useEffect(() => {
    clearGraph();
  }, [replayData?.id, setsFingerprint, effectiveTera, clearGraph]);

  // Opt-in: keep the branch evaluation fresh after each executed turn. Runs
  // on the effective status, so a result that finished for a position the
  // user has meanwhile left (tag mismatch) also re-evaluates. Live positions
  // only: without the liveEvalView gate, navigating onto a main-line turn
  // (the end sentinel included) fired a stray single-turn reconstruction —
  // the "diverged before turn 68" error on a 67-turn game.
  useEffect(() => {
    if (branching && evaluation.prefs.auto && liveEvalView && liveEvalStatus === 'stale' && !executing) {
      handleEvaluate();
    }
  }, [branching, evaluation.prefs.auto, liveEvalView, liveEvalStatus, executing, handleEvaluate]);

  // "Always on" also covers the live sim: a freshly opened variation (or a
  // navigation back to its tip) evaluates without the Evaluate button. Never
  // while the game sweep runs — a single evaluation supersedes the run id
  // and would silently kill the sweep.
  useEffect(() => {
    if (!evaluation.prefs.autoAnalyze || !evalAvailable) return;
    if (!liveTip || executing || branchPreparing || playOut?.active) return;
    if (evaluation.graph.running) return;
    if (liveEvalStatus !== 'idle' && liveEvalStatus !== 'stale') return;
    handleEvaluate();
  }, [
    evaluation.prefs.autoAnalyze, evalAvailable, liveTip, executing, branchPreparing,
    playOut?.active, evaluation.graph.running, liveEvalStatus, handleEvaluate,
  ]);

  // "What if it had …": a team edit plus the normal branch refresh, with the
  // hypothetical move pre-seeded as that slot's pending choice.
  const handleHypotheticalMove = useCallback((
    side: 'p1' | 'p2',
    activeSlot: number,
    params: { species: string; move: string; replace: string | null },
  ) => {
    const sideInfo = side === 'p1' ? effectiveP1Info : effectiveP2Info;
    if (!sideInfo) return;
    // The hypothetical seeds a pending choice where the sim will stand after
    // the refresh: the live tip, or — with no variation — the viewed turn
    // (the refresh flow rebuilds there). Mid-variation views stay inert; the
    // seeded slot would belong to the tip, not the viewed position.
    if (variationSpan !== null && !liveTip) return;

    const speciesId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const pokemon = sideInfo.pokemon.map(entry => {
      if (speciesId(entry.species) !== speciesId(params.species)) return entry;
      const withoutReplaced = params.replace
        ? entry.moves.filter(move => move.name !== params.replace)
        : entry.moves.slice(0, 3);
      return { ...entry, moves: [...withoutReplaced, manualMove(params.move)].slice(0, 4) };
    });
    const updated = { pokemon };

    const nextP1 = side === 'p1' ? updated : effectiveP1Info;
    const nextP2 = side === 'p2' ? updated : effectiveP2Info;
    if (side === 'p1') setEditedP1Info(updated); else setEditedP2Info(updated);

    const seedChoices = (choices: (BranchSlotChoice | null)[], seedSide: 'p1' | 'p2') => {
      const next = [...choices];
      if (seedSide === side) {
        next[activeSlot] = { kind: 'move', moveId: choiceId(params.move), moveName: params.move };
      }
      return next;
    };

    if (nextP1 && nextP2) {
      setPendingBranchRefresh({
        p1Info: nextP1,
        p2Info: nextP2,
        history: [...history],
        p1Choices: seedChoices((liveTip && simState?.p1Choices) || [], 'p1'),
        p2Choices: seedChoices((liveTip && simState?.p2Choices) || [], 'p2'),
      });
    }
  }, [effectiveP1Info, effectiveP2Info, simState, history, liveTip, variationSpan]);

  const handleExecuteTurn = useCallback(async () => {
    await executeTurn();
  }, [executeTurn]);

  const handleSaveTeam = useCallback((side: 'p1' | 'p2', info: OpponentTeamInfo) => {
    const nextP1Info = side === 'p1' ? info : effectiveP1Info;
    const nextP2Info = side === 'p2' ? info : effectiveP2Info;

    if (side === 'p1') {
      setEditedP1Info(info);
    } else {
      setEditedP2Info(info);
    }
    setEditorSide(null);

    if ((branchWindowOpenRef.current || simState) && nextP1Info && nextP2Info) {
      setPendingBranchRefresh({
        p1Info: nextP1Info,
        p2Info: nextP2Info,
        history: [...history],
        p1Choices: [...(simState?.p1Choices ?? [])],
        p2Choices: [...(simState?.p2Choices ?? [])],
      });
    }
  }, [effectiveP1Info, effectiveP2Info, history, simState]);

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
    if (branchWindowOpenRef.current || simState) {
      setPendingBranchRefresh({
        p1Info: nextP1,
        p2Info: nextP2,
        history: [...history],
        p1Choices: [...(simState?.p1Choices ?? [])],
        p2Choices: [...(simState?.p2Choices ?? [])],
      });
    }
    return null;
  }, [replayData, effectiveP1Info, effectiveP2Info, history, simState]);

  // Re-apply this replay's stored sets once the fresh inference exists.
  useEffect(() => {
    if (!pendingStoredSetsRef.current || !p1Info || !opponentInfo) return;
    const stored = pendingStoredSetsRef.current;
    pendingStoredSetsRef.current = null;
    applySetsText(stored);
  }, [p1Info, opponentInfo, applySetsText]);

  const clearSharedBranch = useCallback(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setSharedBranch(null);
    setSharedBranchError(null);
  }, []);

  const handleLoadSharedOriginal = useCallback((replayId: string) => {
    clearSharedBranch();
    void loadReplay(replayId);
  }, [clearSharedBranch, loadReplay]);

  // Canonical link of whatever is loaded — mirrored into the loader input,
  // whichever path (typed URL, file, share link, embed message) loaded it.
  const loadedReplayUrl = replayData
    ? `https://replay.pokemonshowdown.com/${replayData.id}${replayData.viewpoint === 'p2' ? '?p2' : ''}`
    : null;

  const handleReplayTurn = useCallback((turn: number) => {
    if (viewingVariation || turn < 1) return;
    const intent = seekIntentRef.current;
    if (intent && Date.now() < intent.until) {
      if (turn !== intent.turn) return;
      seekIntentRef.current = null;
    }
    setViewTurn(current => {
      // The embed can only report real turns; when the end position is
      // selected its echo (last turn) must not knock the slider back (B12).
      if (endSnapshotTurn !== null && current >= endSnapshotTurn && turn >= endSnapshotTurn - 1) {
        return current;
      }
      return turn;
    });
  }, [viewingVariation, endSnapshotTurn, setViewTurn]);

  const handleGraphSelect = useCallback((turn: number) => {
    // Selecting a turn is user navigation — it bypasses navigateTo, so the
    // same "navigation stops the engine's run" rule applies here.
    if (playOutRef.current?.active) stopPlayOutRef.current?.({ returnToStart: false });
    if (turn >= 1) {
      setViewT0(false);
      seekIntentRef.current = { turn, until: Date.now() + 4000 };
      // Direct, not via handleReplayTurn: an explicit selection beats the
      // echo guards (which exist to protect against the embed, not the user).
      setViewTurn(turn);
    } else {
      // Turn 0: the team-preview view opens — the replay frame seeks to the
      // preview and the lead picker replaces the turn pickers. The intent
      // guard swallows the remount echoes a line switch can trigger.
      seekIntentRef.current = { turn: 0, until: Date.now() + 4000 };
      setViewT0(true);
    }
    setAnalysisTurn(turn);
  }, [setViewTurn]);

  /** Graph clicks name their line explicitly — gold points navigate the
   *  variation, blue points the main line (mockup lesson: line membership
   *  must be unambiguous at every interaction surface). */
  const handleGraphSelectLine = useCallback((turn: number, line?: 'main' | 'variation') => {
    if (line === 'variation') {
      navigateTo({ turn, line: 'variation' });
      return;
    }
    setViewLine('main');
    handleGraphSelect(turn);
  }, [navigateTo, handleGraphSelect]);

  // The analysis follows the replay position — selecting a turn (slider,
  // graph click, stepping) IS the analysis request; there is no separate
  // "open" state. A lead selection (turn 0) survives until the slider moves.
  useEffect(() => {
    if (viewingVariation) return;
    setAnalysisTurn(prev => {
      const turn = Math.min(Math.max(1, viewTurn), analyzableTurns);
      return turn === prev ? prev : turn;
    });
  }, [viewingVariation, viewTurn, analyzableTurns]);

  const leadAnalysisData = useMemo(() => {
    const lead = evaluation.graph.lead;
    if (!lead) return null;
    return analyzeLeads(lead.result, lead.played);
  }, [evaluation.graph.lead]);

  // Tendencies and the turn-event index depend only on the loaded replay —
  // computed once, not per turn click or graph update.
  const tendencies = useMemo(() => (replayData
    ? { p1: parseTendencies(replayData.log, 'p1'), p2: parseTendencies(replayData.log, 'p2') }
    : null), [replayData]);
  const turnEventsIndex = useMemo(
    () => (replayData ? allTurnEvents(replayData.log) : []),
    [replayData],
  );

  // Null-move guard board context (round 5 ⑥): the PRE-TURN active species
  // per side, singles only — anything but exactly one live active passes
  // null and keeps the guard off (fail closed, doubles out of scope).
  const activesForTurn = useCallback((turn: number) => {
    const snapshot = snapshots[turn - 1] ?? null;
    if (!snapshot) return null;
    const activeOf = (side: typeof snapshot.p1): string | null => {
      const active = side.pokemon.filter(pokemon => pokemon.isActive && !pokemon.fainted);
      return active.length === 1 ? active[0].speciesForme : null;
    };
    return { p1: activeOf(snapshot.p1), p2: activeOf(snapshot.p2), gen: replayGen };
  }, [snapshots, replayGen]);

  // Streak-detector history (round 6 ②, narrative channel): per side per
  // turn, who attacked whom with what — read from the replay's own
  // snapshots and protocol lines, render-time only. Gaps push null (breaks
  // streaks; the detector fails closed).
  const playedHistoryAll = useMemo(() => {
    const sides = { p1: [] as (StreakHistoryEntry | null)[], p2: [] as (StreakHistoryEntry | null)[] };
    const turns = evaluation.graph.played.length;
    for (let t = 1; t <= turns; t++) {
      const playedTurn = evaluation.graph.played[t - 1];
      const snapshot = snapshots[t - 1] ?? null;
      const events = turnEventsIndex[t] ?? [];
      const firstMover = events.find(line => line.startsWith('|move|'))?.split('|')[2]?.slice(0, 2) ?? null;
      for (const side of ['p1', 'p2'] as const) {
        const action = playedTurn?.[side] ?? null;
        const own = snapshot?.[side].pokemon.find(pokemon => pokemon.isActive && !pokemon.fainted) ?? null;
        const opp = snapshot?.[side === 'p1' ? 'p2' : 'p1'].pokemon.find(pokemon => pokemon.isActive && !pokemon.fainted) ?? null;
        if (!action || action.kind !== 'move' || !own || !opp) {
          sides[side].push(null);
          continue;
        }
        sides[side].push({
          attacker: own.speciesForme,
          moveId: toID(action.name) || null,
          defender: opp.speciesForme,
          movedFirst: firstMover === side,
          attackerAbility: toID(own.ability),
          defenderAbility: toID(opp.ability),
          defenderItem: toID(opp.item),
          defenderBoosts: { def: opp.boosts['def'] ?? 0, spd: opp.boosts['spd'] ?? 0 },
        });
      }
    }
    return sides;
  }, [evaluation.graph.played, snapshots, turnEventsIndex]);

  // Exploitative Read lens: best response to the opponent model over the
  // already-solved matrix — advisory only, verdicts stay equilibrium-graded.
  const turnReads = useMemo(() => {
    if (analysisTurn === null || analysisTurn < 1 || !tendencies) return null;
    const result = evaluation.graph.results[analysisTurn - 1];
    if (!result?.matrix) return null;
    return {
      p1: computeRead(result.matrix, 'p1', tendencies.p2),
      p2: computeRead(result.matrix, 'p2', tendencies.p1),
    };
  }, [analysisTurn, evaluation.graph, tendencies]);

  const turnAnalysis = useMemo(() => {
    if (analysisTurn === null) return null;
    const result = evaluation.graph.results[analysisTurn - 1];
    const scoreBefore = evaluation.graph.scores[analysisTurn - 1];
    if (!result || scoreBefore === null) return null;
    return analyzeTurn({
      turn: analysisTurn,
      result,
      played: evaluation.graph.played[analysisTurn - 1] ?? null,
      playedOutcome: evaluation.graph.playedOutcome[analysisTurn - 1] ?? null,
      futureOutcomes: evaluation.graph.playedOutcome
        .slice(analysisTurn, analysisTurn + PAYOFF_WINDOW)
        .map(value => value ?? null),
      verified: evaluation.graph.verified[analysisTurn - 1] ?? null,
      sensitivity: evaluation.graph.sensitivity[analysisTurn - 1] ?? null,
      scoreBefore,
      scoreAfter: evaluation.graph.scores[analysisTurn] ?? null,
      playedTracking: true,
      ...(replayData
        ? { sacks: detectSacks(turnEventsIndex[analysisTurn] ?? [], snapshots[analysisTurn - 1] ?? null) }
        : {}),
      ...(turnReads ? { reads: turnReads } : {}),
      actives: activesForTurn(analysisTurn),
      playedHistory: playedHistoryAll,
    });
  }, [analysisTurn, evaluation.graph, replayData, snapshots, turnReads, turnEventsIndex, activesForTurn, playedHistoryAll]);

  // ONE place for everything: in replay view the advantage bar, ranked
  // lists, and matrix render from the ANALYZED turn's cached sweep result
  // (turn 0 = the lead decision) — the branch view keeps its live result.
  const analyzedResult = useMemo(() => {
    if (liveEvalView) return evaluation.result;
    if (analysisTurn === 0) return evaluation.graph.lead?.result ?? null;
    if (analysisTurn !== null && analysisTurn >= 1) return evaluation.graph.results[analysisTurn - 1] ?? null;
    return null;
  }, [liveEvalView, evaluation.result, evaluation.graph, analysisTurn]);

  // What produced the shown result — the panel chip names it instead of
  // silently swapping numbers.
  const analyzedSettings = !liveEvalView && analysisTurn !== null && analysisTurn >= 1
    ? evaluation.graph.settings[analysisTurn - 1] ?? null
    : null;

  // The explicit deepening ladder: a sketch (or gap) first rises to the
  // configured settings, then one depth further (cap 3). Selecting a turn
  // never re-searches — this target is the only escalation.
  const thinkDeeperTarget = useMemo((): TurnEvalSettings | { mode: 'auto' } | null => {
    if (liveEvalView || analysisTurn === null || analysisTurn < 1) return null;
    const stored = evaluation.graph.settings[analysisTurn - 1] ?? null;
    const fraction = evaluation.graph.faintedFractions[analysisTurn - 1] ?? null;
    if (!stored || needsSettingsUpgrade(stored, evaluation.prefs, fraction)) {
      if (evaluation.prefs.mode === 'auto') {
        // Rise to the turn's auto-resolved engine; a gap turn's routing
        // signal is unknown until swept — the sweep resolves it itself.
        return fraction !== null ? resolveAutoTurnSettings(fraction) : { mode: 'auto' };
      }
      return { depth: evaluation.prefs.depth, samples: evaluation.prefs.samples, mode: evaluation.prefs.mode };
    }
    // From an MCTS turn the button crosses into the matrix ladder at depth
    // 2 — the same rung the early d1s1 line escalates to. The escalation-
    // keep rule (supersedesStored) makes the product survive later sweeps.
    if (stored.mode === 'mcts') {
      return {
        depth: 2,
        samples: Math.max(stored.samples, evaluation.prefs.samples) as TurnEvalSettings['samples'],
        mode: 'matrix',
      };
    }
    // The matrix ladder caps at the engine's depth 3.
    if (stored.depth >= 3) return null;
    return {
      depth: (stored.depth + 1) as 2 | 3,
      // Never shed samples on the way up — a d3s3 run must supersede d2s5.
      samples: Math.max(stored.samples, evaluation.prefs.samples) as TurnEvalSettings['samples'],
      mode: 'matrix',
    };
  }, [liveEvalView, analysisTurn, evaluation.graph.settings, evaluation.graph.faintedFractions, evaluation.prefs]);

  const handleThinkDeeper = useCallback(() => {
    if (analysisTurn === null || analysisTurn < 1 || !thinkDeeperTarget) return;
    // The 'auto' sentinel means "no override" — the sweep resolves the
    // turn's engine from its position, exactly like Analyze game.
    analyzeTurnNow(analysisTurn, 'depth' in thinkDeeperTarget ? thinkDeeperTarget : undefined);
  }, [analysisTurn, thinkDeeperTarget, analyzeTurnNow]);

  const replayWinner = useMemo<'p1' | 'p2' | null>(() => {
    if (!replayData) return null;
    const name = replayData.log.match(/\|win\|(.+)/)?.[1]?.trim();
    if (!name) return null;
    if (name === replayData.players[0]) return 'p1';
    if (name === replayData.players[1]) return 'p2';
    return null;
  }, [replayData]);

  // Game-level root cause, once enough of the game is swept. The memo keeps
  // the per-turn analyses next to the report: the feedback drift harness
  // (and manual debugging) read both through the window handle below.
  const gameReportDataRef = useRef<{ report: GameReport; analyses: (TurnAnalysis | null)[] } | null>(null);
  const gameReportData = useMemo(() => {
    if (!replayData) {
      gameReportDataRef.current = null;
      return null;
    }
    const { results, scores, played, playedOutcome, verified, sensitivity, running } = evaluation.graph;
    // While a sweep runs, the LAST report stays up — recomputing waits for
    // completion (per-tick rebuilds are expensive), but returning null here
    // made the report blink on every turn click once selection started
    // triggering 2-turn upgrade sweeps.
    if (running) return gameReportDataRef.current;
    // The report walk speaks each entry sentence once (round 14): keys of
    // already-spoken unanswered stages accumulate turn by turn, so a mon's
    // tenth entry stays quiet here while the per-turn card (no set passed)
    // keeps its sentence.
    const unansweredSeen = new Set<string>();
    // Round 15: the decided/near announcements share the walk regime — the
    // state stays on every decided turn, the sentence speaks once.
    const decidedSeen = new Set<string>();
    const analyses = results.map((result, index) => {
      const scoreBefore = scores[index];
      if (!result || scoreBefore === null) return null;
      const analysis = analyzeTurn({
        turn: index + 1,
        result,
        played: played[index] ?? null,
        playedOutcome: playedOutcome[index] ?? null,
        futureOutcomes: playedOutcome
          .slice(index + 1, index + 1 + PAYOFF_WINDOW)
          .map(value => value ?? null),
        verified: verified[index] ?? null,
        sensitivity: sensitivity[index] ?? null,
        scoreBefore,
        scoreAfter: scores[index + 1] ?? null,
        playedTracking: true,
        sacks: detectSacks(turnEventsIndex[index + 1] ?? [], snapshots[index] ?? null),
        actives: activesForTurn(index + 1),
        playedHistory: playedHistoryAll,
        unansweredSeen,
        decidedSeen,
      });
      for (const key of ['p1', 'p2'] as const) {
        const signal = analysis[key].unanswered;
        if (signal) unansweredSeen.add(unansweredSeenKey(key, signal));
        const decided = analysis[key].decided;
        if (decided?.announce) decidedSeen.add(decidedSeenKey(key, { species: decided.species }));
        const near = analysis[key].nearDecided;
        if (near?.announce) {
          decidedSeen.add(decidedSeenKey(key, { species: near.species, removes: near.removes }));
        }
      }
      return analysis;
    });
    if (analyses.filter(Boolean).length < 3) {
      gameReportDataRef.current = null;
      return null;
    }
    const report = buildGameReport(
      analyses, [replayData.players[0], replayData.players[1]], replayWinner, true,
    );
    const data = { report, analyses };
    gameReportDataRef.current = data;
    return data;
  }, [replayData, snapshots, evaluation.graph, replayWinner, turnEventsIndex, activesForTurn, playedHistoryAll]);
  const gameReport = gameReportData?.report ?? null;

  // Structured handle for the feedback drift harness: the SAME objects the
  // UI renders — no recomputation, no behavior change.
  useEffect(() => {
    (window as Window & { __psDebug?: unknown }).__psDebug = {
      graph: evaluation.graph,
      analyses: gameReportData?.analyses ?? null,
      gameReport: gameReportData?.report ?? null,
      haxAlignment: sweepAlignment
        ? { records: sweepAlignment, summary: summarizeAlignment(sweepAlignment) }
        : null,
    };
  }, [evaluation.graph, gameReportData, sweepAlignment]);

  const teamPasteStatus = useMemo(() => {
    if (!pastedSets || pastedSets.length === 0) return null;
    if (!p1Info) return `Team loaded (${pastedSets.length} Pokémon)`;
    const matched = countMatchingSpecies(p1Info, pastedSets);
    return `Team loaded (${pastedSets.length} Pokémon, ${matched} match this replay)`;
  }, [pastedSets, p1Info]);
  const teamPasteMismatch = useMemo(() => {
    if (!pastedSets || pastedSets.length === 0 || !p1Info) return null;
    return countMatchingSpecies(p1Info, pastedSets) === 0
      ? 'None of the pasted Pokémon appear in this replay; the paste will be ignored for branching.'
      : null;
  }, [pastedSets, p1Info]);

  const simLog = useMemo(() => {
    const raw = simState?.log ?? [];
    if (raw.length === 0) return '';
    // |debug| lines would render as "[DEBUG] …" in the embed's battle log (G13).
    return raw.filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|') && !l.startsWith('|debug|')).join('\n');
  }, [simState?.log]);
  const latestBranchHistoryEntry = history.length > 0 ? history[history.length - 1] : null;

  const showBranch = branching && simLog.length > 0;
  // Session + branch start, NOT the viewed turn: the pointer moves constantly
  // on the unified timeline, and a viewTurn-keyed reload would remount the
  // sim iframe on every navigation and every executed turn (tip advance).
  const branchReloadKey = `${branchSession}:${variationStartTurn ?? 0}`;

  return (
    <div className="ps-app-root">
      {/* Header (hidden when framed by a host site, and once a replay is
          loaded — on a 1080p screen every row above the pickers counts). */}
      {!embed && !replayData && (
        <div className="ps-app-header" style={{ borderRadius: '0 0 5px 5px' }}>
          <h1>PS Dashboard</h1>
          <span style={{ fontSize: 10, color: '#aabbcc' }}>
            Load a replay · branch off with different moves
          </span>
        </div>
      )}

      {sharedBranchError && !sharedBranch && (
        <div className="ps-panel" role="alert" style={{ marginTop: 8, color: '#f3a6a6', fontSize: 11 }}>
          Unable to open shared branch: {sharedBranchError}
        </div>
      )}

      {sharedBranch && (
        <SharedBranchView
          branch={sharedBranch}
          onLoadOriginal={handleLoadSharedOriginal}
          onClear={clearSharedBranch}
        />
      )}

      {!replayData && !sharedBranch && (embed ? (
        // The host page provides the replay — no loader chrome in embed mode.
        <div className="ps-panel" style={{ marginTop: 8, fontSize: 12, color: '#aebdd0' }}>
          {error ? (
            <span role="alert" style={{ color: '#f3a6a6' }}>{error}</span>
          ) : loading || requestedReplay ? (
            'Loading replay…'
          ) : (
            'Waiting for a replay from the host page…'
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <ReplayLoader
            onLoad={loadReplay}
            onLoadFile={loadReplayFile}
            onTeamLoad={handleTeamLoad}
            loading={loading}
            error={error}
            loadedUrl={loadedReplayUrl}
            teamStatus={teamPasteStatus}
            teamError={teamPasteError || teamPasteMismatch}
            showGuide
          />
        </div>
      ))}

      {replayData && !sharedBranch && (
        <div className="ps-main-layout">
          {/* Left column: iframe */}
          <div className="ps-main-left">
            {/* Match info + loader collapsed into one bar */}
            <div className="ps-topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <span className="ps-format-tag">{replayData.format}</span>
                <span style={{ fontSize: 11, color: '#8ac' }}>{replayData.players[0]}</span>
                <span style={{ fontSize: 10, color: '#556' }}>vs</span>
                <span style={{ fontSize: 11, color: '#c8a' }}>{replayData.players[1]}</span>
                {usageStats.loading && (
                  <span style={{ fontSize: 10, color: '#b6a46a' }}>Smogon stats loading...</span>
                )}
                {usageStats.error && (
                  <span style={{ fontSize: 10, color: '#987' }}>Smogon stats unavailable</span>
                )}
                {setAssumptions.loading && (
                  <span style={{ fontSize: 10, color: '#b6a46a' }}>Smogon sets loading...</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {branchPreparing && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fd6' }}>
                      Preparing branch...
                      {branchProgress ? ` (turn ${branchProgress.turn}/${branchProgress.target})` : ''}
                    </span>
                    <button
                      type="button"
                      className="ps-btn"
                      onClick={handleCancelBranchPreparation}
                      style={{ padding: '2px 8px', fontSize: 10 }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {showBranch && !branchPreparing && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
                      Branching · Turn {simState?.turnNumber ?? '…'}
                    </span>
                    {simState?.ended && (
                      <span className="ps-ended-tag">
                        {simState.winner ? `${simState.winner} wins!` : 'Ended'}
                      </span>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
                      <input
                        type="checkbox"
                        checked={animateBranchTurns}
                        onChange={event => setAnimateBranchTurns(event.target.checked)}
                      />
                      Animate branch turns
                    </label>
                    {branchDivergence && (
                      <span
                        style={{ fontSize: 10, color: '#e6b36a', maxWidth: 520 }}
                        title={branchDivergence}
                      >
                        ⚠ {branchDivergence}
                      </span>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setEditorSide('p1')}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Edit Player
                </button>
                <button
                  type="button"
                  onClick={() => setEditorSide('p2')}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Edit Opp
                </button>
                <button
                  type="button"
                  onClick={() => setSetsPanelOpen(true)}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Import/Export Sets
                </button>
              </div>
            </div>

            {/* Single iframe */}
            <div className="ps-iframe-wrap">
              {showBranch && viewingVariation ? (
                <PSReplayFrame
                  key="branch"
                  log={simLog}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  title="Branch Simulation"
                  height={480}
                  seekTurn={viewTurn}
                  autoPlay={false}
                  viewpoint={replayData.viewpoint}
                  liveUpdates
                  liveAppendMode={playOut?.active ? 'hold' : animateBranchTurns ? 'play' : 'follow-end'}
                  liveAppendTurn={latestBranchHistoryEntry?.turnNumber ?? null}
                  reloadKey={branchReloadKey}
                  seekRequest={navSeek}
                />
              ) : (
                <PSReplayFrame
                  key="replay"
                  log={replayData.log}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  height={480}
                  seekTurn={viewT0 ? 0 : viewTurn}
                  autoPlay={false}
                  viewpoint={replayData.viewpoint}
                  reloadKey={`${replayData.id}:original`}
                  onTurnChange={handleReplayTurn}
                />
              )}
            </div>

            {/* Timeline bar: always visible — one slider over main line and variation */}
            <div className="ps-branch-bar">
              <span style={{ fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap', color: '#cde' }}>Timeline</span>
              <button
                type="button"
                className="ps-btn"
                onClick={() => handleGraphSelectLine(0)}
                title="Turn 0: team preview. Pick different leads and play the game from the start."
                aria-pressed={viewT0}
                style={{
                  padding: '2px 6px', fontSize: 10,
                  ...(viewT0 ? { borderColor: '#8cf', color: '#8cf' } : {}),
                }}
              >T0</button>
              <button
                type="button"
                onClick={() => (viewTurn <= 1 && !viewT0
                  ? handleGraphSelectLine(0)
                  : navigateTo({ turn: viewTurn - 1, line: viewLine }))}
                disabled={viewTurn <= 1 && viewT0}
                className="ps-btn"
                style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
              >&#9664;</button>
              <span className="ps-timeline-track">
                {variationSpan && (() => {
                  // Gold stripe under the slider marking where the variation
                  // lives — without it nothing on the timeline said so.
                  const max = sliderMax(maxTurn, variationSpan);
                  const pos = (turn: number) => (max <= 1 ? 0 : ((turn - 1) / (max - 1)) * 100);
                  // A turn-0 variation starts left of the slider's domain.
                  const from = Math.max(0, pos(variationSpan.startTurn));
                  const to = pos(variationTip(variationSpan));
                  return (
                    <span
                      className="ps-timeline-stripe"
                      style={{ left: `${from}%`, width: `${Math.max(to - from, 0.8)}%` }}
                      title={`Variation: turns ${variationSpan.startTurn}–${variationTip(variationSpan)}`}
                    />
                  );
                })()}
                <input
                  type="range"
                  min={1}
                  max={sliderMax(maxTurn, variationSpan)}
                  value={viewTurn}
                  onChange={e => navigateTo({ turn: parseInt(e.target.value, 10), line: viewLine })}
                  aria-label="Timeline turn selector"
                />
              </span>
              <button
                type="button"
                onClick={() => navigateTo({ turn: viewT0 ? 1 : viewTurn + 1, line: viewLine })}
                disabled={!viewT0 && viewTurn >= sliderMax(maxTurn, variationSpan)}
                className="ps-btn"
                style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
              >&#9654;</button>
              <span style={{ fontSize: 11, color: '#aab', minWidth: 60, textAlign: 'center' }}>
                {viewT0 ? (
                  <strong style={{ color: '#fff' }}>T0</strong>
                ) : atEndPosition && !viewingVariation ? (
                  <strong style={{ color: '#fff' }}>End</strong>
                ) : (
                  <>
                    {/* The total counts PLAYED turns — the end snapshot is the
                        "End" sentinel, not a 68th turn of a 67-turn game. */}
                    T<strong style={{ color: '#fff' }}>{viewTurn}</strong>/{sliderMax(endSnapshotTurn !== null ? endSnapshotTurn - 1 : maxTurn, variationSpan)}
                  </>
                )}
              </span>
              {/* The chip stays put while a variation exists — flickering away
                  outside the covered turns made the whole bar jump around. */}
              {variationSpan !== null && (
                <span className="ps-line-chip" role="group" aria-label="Line selector">
                  <button
                    type="button"
                    className={!viewingVariation ? 'on-main' : ''}
                    onClick={() => navigateTo({ turn: Math.min(viewTurn, maxTurn), line: 'main' })}
                  >Main line</button>
                  <button
                    type="button"
                    className={viewingVariation ? 'on-vari' : ''}
                    onClick={() => navigateTo({
                      turn: Math.min(Math.max(viewTurn, variationSpan.startTurn + 1), variationTip(variationSpan)),
                      line: 'variation',
                    })}
                  >Variation</button>
                </span>
              )}
              {(variationSpan !== null || branching) && (
                <button
                  type="button"
                  className="ps-btn ps-btn-red"
                  onClick={discardVariation}
                  title="Drops every played variation move."
                  style={{ padding: '3px 10px', fontSize: 11 }}
                >
                  Discard variation
                </button>
              )}
            </div>

            {branchDivergence && !showBranch && (
              <div className="ps-panel" role="alert" style={{ marginTop: 6, padding: '6px 10px', fontSize: 11, color: '#e6b36a' }}>
                ⚠ {branchDivergence}
              </div>
            )}
            {pendingConfirm && (
              <div
                className="ps-panel"
                role="alertdialog"
                style={{
                  marginTop: 6, padding: '7px 10px', display: 'flex', gap: 10, alignItems: 'center',
                  fontSize: 11, borderColor: 'rgba(204,68,85,0.5)',
                }}
              >
                <span>{pendingConfirm.message}</span>
                <button type="button" className="ps-btn ps-btn-red" onClick={pendingConfirm.proceed}>
                  Replace
                </button>
                <button
                  type="button"
                  className="ps-btn"
                  onClick={() => { setPendingConfirm(null); setPendingEvalPick(null); setPlayOut(null); }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Variant B: the pickers are ALWAYS there — live sim state at the
                tip, resolved picker state (stored/snapshot) everywhere else.
                On T0 the lead picker takes their place. */}
            {playOut?.active ? (
              /* A steady stand-in while the engine plays: the per-turn picker
                 churn was the "everything keeps switching" complaint, and a
                 click here mid-run would corrupt the loop anyway. */
              <div className="ps-panel" role="status" style={{ fontSize: 11, color: '#aabbcc' }}>
                <span className="ps-spinner" aria-hidden="true" />{' '}
                The engine is picking both sides&rsquo; moves — the pickers come back when it stops.
              </div>
            ) : viewT0 ? (
              <LeadPanel
                key={`${replayData.id}:${leadOptions.p1.length}`}
                playerNames={[replayData.players[0], replayData.players[1]]}
                p1Options={leadOptions.p1}
                p2Options={leadOptions.p2}
                leadsPerSide={replayGameType === 'doubles' ? 2 : 1}
                bringCount={bringCount}
                pickedLeads={variationSpan?.startTurn === 0 ? history[0]?.leadChoices ?? null : null}
                executing={executing || branchPreparing}
                onStart={leads => startLeadVariation(bringCount !== null ? { ...leads, bring: true } : leads)}
              />
            ) : (
            <BranchPanel
              simState={liveTip ? simState : pickerSimState}
              source={liveTip ? 'live' : positionPicker?.source}
              acquiringExact={!liveTip && exactAcquiringTurn === viewTurn}
              executeError={executeError}
              executing={executing || branchPreparing}
              gen={replayGen}
              onSetChoice={handleSetChoice}
              onHypotheticalMove={handleHypotheticalMove}
              onExecuteTurn={liveTip ? handleExecuteTurn : handleExecuteDraft}
              played={playedAtView}
            />
            )}
            {(branching || variationSpan !== null) && (
              <>
                <BranchHistoryPanel
                  branchStartTurn={variationSpan?.startTurn ?? viewTurn}
                  history={history}
                  snapshots={snapshots}
                  currentPosition={{ turn: viewTurn, line: viewingVariation ? 'variation' : 'main' }}
                  onNavigate={navigateTo}
                />
                <BranchSaveSharePanel
                  replayData={replayData}
                  branchTurn={variationSpan?.startTurn ?? viewTurn}
                  history={history}
                  finalLog={simLog}
                />
              </>
            )}
            {!embed && (
              <ReplayLoader
                onLoad={loadReplay}
                onLoadFile={loadReplayFile}
                onTeamLoad={handleTeamLoad}
                loading={loading}
                error={error}
                loadedUrl={loadedReplayUrl}
                teamStatus={teamPasteStatus}
                teamError={teamPasteError || teamPasteMismatch}
              />
            )}
          </div>

          {/* Right column: evaluation beside the battle (chess-style), then stats */}
          <div className="ps-main-right">
            {evalAvailable && (
              <EvalPanel
                playerNames={[replayData.players[0], replayData.players[1]]}
                status={liveEvalView ? liveEvalStatus : 'idle'}
                result={analyzedResult}
                resultSettings={analyzedSettings}
                onThinkDeeper={!liveEvalView ? handleThinkDeeper : undefined}
                thinkDeeperTarget={!liveEvalView ? thinkDeeperTarget : null}
                smogonPending={usageStats.loading || setAssumptions.loading}
                progress={evaluation.progress}
                reconstructProgress={evaluation.reconstructProgress}
                error={evaluation.error}
                prefs={evaluation.prefs}
                onPrefsChange={evaluation.setPrefs}
                onEvaluate={liveEvalView ? handleEvaluate : undefined}
                onCancel={evaluation.cancel}
                onPickChoice={handleExploreChoice}
                onPickPair={handlePickPair}
                showAuto={liveEvalView}
                showTera={replayGen === 9}
                graph={evaluation.graph}
                onAnalyzeGame={handleAnalyzeGame}
                positionLabel={liveEvalView ? `Turn ${viewTurn} · ${viewingVariation ? 'variation' : 'main line'}` : null}
                playOutProgress={playOut?.active ? { startTurn: playOut.startTurn, turns: playOut.turns, atTurn: liveSimTurn } : null}
                graphMaxTurn={analyzableTurns}
                analysisTurn={analysisTurn}
                onSelectTurn={handleGraphSelectLine}
                currentTurn={viewTurn}
                currentLine={viewingVariation ? 'variation' : 'main'}
                variation={variationSpan ? { startTurn: variationSpan.startTurn, scores: variationScores } : null}
                analysis={!liveEvalView ? turnAnalysis : null}
                reads={!liveEvalView ? turnReads : null}
                leadAnalysis={!liveEvalView && analysisTurn === 0 ? leadAnalysisData : null}
                reportLeads={leadAnalysisData}
                report={!liveEvalView ? gameReport : null}
                doubles={replayGameType === 'doubles'}
              />
            )}
            {evalAvailable && (
              <div className="ps-panel" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {playOut?.active ? (
                  <>
                    <span className="ps-spinner" aria-hidden="true" />
                    {/* The detailed progress line lives in the Evaluation
                        panel (beside the growing graph) — one place, not two. */}
                    <span style={{ fontSize: 11, color: '#f0c76b' }}>
                      Engine play-out running
                    </span>
                    <button type="button" className="ps-btn" onClick={() => stopPlayOut()} style={{ padding: '2px 10px', fontSize: 11 }}>
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ps-btn"
                      onClick={startPlayOut}
                      disabled={branchPreparing || usageStats.loading || setAssumptions.loading}
                      title="The engine plays BOTH sides' best moves from the position you are viewing until the game ends. The view stays on this turn while it runs; when it stops, press play (or Watch) to see the finished line. Stop anytime; played turns stay in the variation."
                      style={{ padding: '3px 10px', fontSize: 11, borderColor: 'rgba(240,199,107,0.5)' }}
                    >
                      &#9658; Let it play out
                    </button>
                    <span style={{ fontSize: 10, color: '#8fa3bd' }}>
                      engine finishes the game from turn {viewTurn}; watch the result from here afterwards
                    </span>
                  </>
                )}
                {playOutNotice && !playOut?.active && (
                  <span role="status" style={{ fontSize: 10, color: '#d4f5e0', display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {playOutNotice.text}
                    {variationSpan !== null && (
                      <button
                        type="button"
                        className="ps-btn"
                        onClick={() => watchFrom(playOutNotice.watchTurn)}
                        title="Seek the battle window to where the play-out started and play it."
                        style={{ padding: '1px 8px', fontSize: 10 }}
                      >
                        &#9658; Watch from turn {playOutNotice.watchTurn}
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}
            <BattleStatsPanel
              replayData={replayData}
              p1Info={statsP1Info}
              p2Info={statsP2Info}
            />
          </div>
        </div>
      )}

      {setsPanelOpen && replayData && (
        <SetsImportExportPanel
          exportText={buildSetsExport({
            p1Name: replayData.players[0] ?? 'p1',
            p2Name: replayData.players[1] ?? 'p2',
            p1Info: effectiveP1Info,
            p2Info: effectiveP2Info,
          })}
          onImport={text => {
            const importError = applySetsText(text);
            if (!importError) setSetsPanelOpen(false);
            return importError;
          }}
          onClose={() => setSetsPanelOpen(false)}
        />
      )}

      {editorSide === 'p1' && effectiveP1Info && (
        <TeamEditor
          title="Edit Player Team"
          teamInfo={effectiveP1Info}
          gen={replayGen}
          onSave={(info) => handleSaveTeam('p1', info)}
          onClose={() => setEditorSide(null)}
        />
      )}

      {editorSide === 'p2' && effectiveP2Info && (
        <TeamEditor
          title="Edit Opponent Team"
          teamInfo={effectiveP2Info}
          gen={replayGen}
          onSave={(info) => handleSaveTeam('p2', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
    </div>
  );
}

export default App;
