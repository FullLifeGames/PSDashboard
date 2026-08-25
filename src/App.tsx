import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import { useReplay } from './hooks/useReplay';
import { finalPlayedTurn } from './lib/replay-turns';
import { useEmbedHost } from './hooks/useEmbedHost';
import { useBranch } from './hooks/useBranch';
import type { BranchHistoryEntry } from './hooks/useBranch';
import { useSmogonUsageStats } from './hooks/useSmogonUsageStats';
import { useSmogonSetAssumptions } from './hooks/useSmogonSetAssumptions';
import { ReplayLoader } from './components/ReplayLoader';
import { PSReplayFrame } from './components/PSReplayFrame';
import { BranchPanel } from './components/BranchPanel';
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
import type { OpponentTeamInfo } from './types';
import { decodeBranchShare, type BranchSharePayload } from './lib/branch-share';
import { formatEnforcesSleepClause, getBranchSimulatorFormat, getReplayGameType, getReplayGeneration, inferReplayFormatId } from './lib/replay-format';
import { resolveTeraPreference } from './lib/eval/tera';
import { summarizeAlignment, type TurnAlignmentRecord } from './lib/hax-alignment';
import { choiceId, evalChoiceToSlotChoices, type BranchSlotChoice } from './lib/branch-choices';
import type { RankedChoice } from './lib/eval/types';
import { allTurnEvents, detectSacks, parseLeadSpecies, parsePlayedActions, parsePlayedActionsDoubles } from './lib/eval/played';
import { analyzeTurn, PAYOFF_WINDOW, type TurnAnalysis } from './lib/eval/analysis';
import { toID } from '@pkmn/dex';
import type { StreakHistoryEntry } from './lib/eval/streaks';
import { computeRead, parseTendencies } from './lib/eval/opponent-model';
import { analyzeLeads } from './lib/eval/leads';
import { buildGameReport, type GameReport } from './lib/eval/report';

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

function App() {
  const { loading, error, replayData, snapshots, observations, speedOrders, hpEvidence, opponentInfo, p1Info, loadReplay, loadReplayFile } = useReplay();
  const { embed, requestedReplay } = useEmbedHost({ loadReplay, loadReplayFile });
  const { branching, simState, history, executeError, executing, startBranch, setChoice, executeTurn, stopBranch, getBattle } = useBranch();
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
  const [branchTurn, setBranchTurnState] = useState(1);
  /**
   * Synchronous mirror of branchTurn: a slider change followed by an
   * immediate "Branch Here" click can fire BEFORE React commits the
   * re-render, so the click handler's closure still holds the old turn
   * (the branch then starts on the wrong turn — seen as e2e flake under
   * CPU load, but a real race for fast human hands too). Handlers that
   * act on the selected turn read the ref, never the closure state.
   */
  const branchTurnRef = useRef(1);
  const setBranchTurn = useCallback((value: number | ((turn: number) => number)) => {
    // The REF is authoritative and written synchronously in the event —
    // a setState updater only runs at the NEXT render, which is exactly
    // the window the race lives in.
    const next = typeof value === 'function' ? value(branchTurnRef.current) : value;
    branchTurnRef.current = next;
    setBranchTurnState(next);
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

  // The last snapshot is the post-battle end state when it holds the final
  // turn's residue instead of starting a new |turn| — it is labelled "End",
  // kept stable against iframe echoes, and blocked as a branch target
  // (B10/B12/G23).
  const endSnapshotTurn = useMemo(() => {
    if (snapshots.length < 2) return null;
    const last = snapshots[snapshots.length - 1];
    return last.log.some(line => line.startsWith('|turn|')) ? null : last.turn;
  }, [snapshots]);
  const atEndPosition = endSnapshotTurn !== null && branchTurn >= endSnapshotTurn;

  // A freshly loaded replay must start clean: slider at turn 1 (B11), no live
  // branch, and no team edits carried over from the previous replay. Host
  // pages can inject replays repeatedly via ps-load-replay, so the previous
  // game's state must never leak into the next one.
  useEffect(() => {
    setBranchTurn(1);
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
  }, [replayData?.id, stopBranch, setBranchTurn]);

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
      setTeamPasteError('Could not read any Pokémon sets from the paste — expected the Showdown export format.');
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

  const branchSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null;
    const idx = Math.min(branchTurn - 1, snapshots.length - 1);
    return snapshots[idx];
  }, [snapshots, branchTurn]);

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

  const handleBranch = useCallback(async () => {
    if (!replayData || branchPreparing) return;
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
        // The ref, not the closure: see branchTurnRef (slider→click race).
        const selectedTurn = branchTurnRef.current;
        const selectedSnapshot = snapshots.length > 0
          ? snapshots[Math.min(selectedTurn - 1, snapshots.length - 1)] ?? null
          : null;
        await startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, selectedTurn, selectedSnapshot, {
          playerNames: [replayData.players[0], replayData.players[1]],
          onProgress: (turn, target) => setBranchProgress({ turn, target }),
          abort: abortController.signal,
          snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
          choiceLocks,
        });
        if (!abortController.signal.aborted) {
          branchWindowOpenRef.current = true;
          const branchBattle = getBattle();
          if (branchBattle?.ended) {
            setBranchDivergence('The simulated replay diverged from the real game and already ended' +
              `${branchBattle.winner ? ` (${branchBattle.winner} won the simulated line)` : ''} — ` +
              'the guessed sets could not reproduce this position. Recommendations cannot be played out here; ' +
              'correcting items/moves via Edit Player/Opp usually fixes the divergence.');
          } else if (branchBattle && branchBattle.turn < selectedTurn) {
            setBranchDivergence(`The simulated replay wedged at turn ${branchBattle.turn} on the way to ` +
              `turn ${selectedTurn} — the guessed sets diverge from the real game before this position.`);
          } else {
            setBranchDivergence(null);
          }
        }
      }
    } finally {
      setBranchPreparing(false);
      setBranchProgress(null);
      branchAbortRef.current = null;
    }
  }, [replayData, branchPreparing, teamText, snapshots, observations, hpEvidence, getInferredSpreads, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, startBranch, getBattle]);

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
          await startBranch(getBranchSimulatorFormat(activeReplay), p1Team, p2Team, activeReplay.log, branchTurn, branchSnapshot, {
            replayHistory: refreshRequest.history,
            p1Choices: refreshRequest.p1Choices,
            p2Choices: refreshRequest.p2Choices,
            playerNames: [activeReplay.players[0], activeReplay.players[1]],
            onProgress: (turn, target) => setBranchProgress({ turn, target }),
            abort: abortController.signal,
            snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
            choiceLocks,
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
    branchTurn,
    branchSnapshot,
    snapshots,
    usageStats.stats,
    setAssumptions.assumptions,
    observations,
    hpEvidence,
    startBranch,
  ]);

  const handleSetChoice = useCallback((side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => {
    setChoice(side, choice, activeSlot);
  }, [setChoice]);

  // ----- Position evaluation (singles + doubles) -----
  const replayGameType = useMemo(
    () => (replayData ? getReplayGameType(replayData.log) : null),
    [replayData],
  );
  const evalAvailable = useMemo(
    () => !!replayData && (replayGameType === null || replayGameType === 'singles' || replayGameType === 'doubles'),
    [replayData, replayGameType],
  );
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
        throw new Error(`The reconstruction diverged before turn ${turn} — the guessed sets could not reproduce this position. Correcting items/moves via Edit Player/Opp usually fixes it.`);
      }
      return serializeLiveBattle(battle);
    }, [replayData, teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, snapshots, observations, hpEvidence, getInferredSpreads]);

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
          `The simulated battle ended at turn ${finalBattle.turn} although the real game continued — ` +
          `no candidate seed avoided the divergence, so later turns have no positions.`,
        );
      }
      const invalid = branchEngine.validateBranchRuntime(runtime);
      const battle = runtime.battleStream.battle;
      if (!invalid && battle && branchEngine.reconstructionReached(runtime, turns)) {
        const serialized = serializeLiveBattle(battle);
        positions[turns - 1] = serialized;
        onPosition?.(turns, serialized);
      }
      return positions;
    }, [replayData, teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, snapshots, observations, hpEvidence, getInferredSpreads]);

  const acquireReplayPosition = useMemo(() => makeReplayAcquire(branchTurn), [makeReplayAcquire, branchTurn]);

  const handleEvaluate = useCallback(() => {
    if (!replayData) return;
    if (branching) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, acquire: acquireBranchPosition });
    } else {
      evaluation.evaluate({
        cacheKey: `${replayData.id}:${branchTurn}:${setsFingerprint}`,
        tera: effectiveTera,
        sleepClause: effectiveSleepClause,
        acquire: acquireReplayPosition,
      });
    }
  }, [replayData, branching, evaluation, effectiveTera, effectiveSleepClause, acquireBranchPosition, acquireReplayPosition, branchTurn, setsFingerprint]);

  // Clicking a recommended choice pre-fills the branch pickers.
  const applyEvalChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice): boolean => {
    if (!simState) return false;
    const movesBySlot = side === 'p1' ? simState.p1MovesBySlot : simState.p2MovesBySlot;
    const switchesBySlot = side === 'p1' ? simState.p1SwitchesBySlot : simState.p2SwitchesBySlot;
    const slotChoices = evalChoiceToSlotChoices(ranked.choice, movesBySlot, switchesBySlot, ranked.label);
    if (!slotChoices) return false;
    let applied = false;
    slotChoices.forEach((choice, activeSlot) => {
      if (!choice) return;
      handleSetChoice(side, choice, slotChoices.length > 1 ? activeSlot : undefined);
      applied = true;
    });
    return applied;
  }, [simState, handleSetChoice]);

  // Chess-style walk: clicking an engine line PLAYS THE TURN OUT — the
  // clicked side commits its line, the other side answers with the engine's
  // top reply, the turn executes, and the result re-evaluates so the next
  // recommendations are already waiting for the next click.
  const playOutEvalChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply: RankedChoice | null) => {
    // A diverged/finished branch sim cannot accept choices — refuse with the
    // divergence notice instead of letting the sim reject confusingly.
    if (getBattle()?.ended) {
      setBranchDivergence(previous => previous ??
        'The simulated replay already ended — recommendations cannot be played out in this diverged line.');
      return;
    }
    if (!applyEvalChoice(side, ranked)) return;
    const other = side === 'p1' ? 'p2' : 'p1';
    if (reply && applyEvalChoice(other, reply)) {
      void executeTurn().then(() => handleEvaluate());
      return;
    }
    // No engine reply to commit (forced-switch positions execute through
    // setChoice on their own) — show the engine's view of what stands.
    handleEvaluate();
  }, [applyEvalChoice, executeTurn, handleEvaluate, getBattle]);

  const [pendingEvalPick, setPendingEvalPick] =
    useState<{ side: 'p1' | 'p2'; ranked: RankedChoice; reply: RankedChoice | null } | null>(null);

  const handleExploreChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply?: RankedChoice | null) => {
    // The walk re-evaluates after every executed turn — surface that as the
    // visible Auto setting rather than a hidden mode.
    if (!evaluation.prefs.auto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
    if (branching) {
      playOutEvalChoice(side, ranked, reply ?? null);
      return;
    }
    setPendingEvalPick({ side, ranked, reply: reply ?? null });
    void handleBranch();
  }, [branching, playOutEvalChoice, handleBranch, evaluation]);

  // A matrix cell names BOTH sides' choices — play exactly that pair out
  // (draft T48: "what would Shadow Ball into Knock Off look like?").
  const handlePickPair = useCallback((p1: { choice: string; label: string }, p2: { choice: string; label: string }) => {
    const rankedLike = (entry: { choice: string; label: string }): RankedChoice =>
      ({ choice: entry.choice, label: entry.label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
    handleExploreChoice('p1', rankedLike(p1), rankedLike(p2));
  }, [handleExploreChoice]);

  useEffect(() => {
    if (!pendingEvalPick) return;
    if (branching && simState) {
      playOutEvalChoice(pendingEvalPick.side, pendingEvalPick.ranked, pendingEvalPick.reply);
      setPendingEvalPick(null);
    } else if (!branching && !branchPreparing) {
      // Branch entry failed or was cancelled — drop the stale pick.
      setPendingEvalPick(null);
    }
  }, [pendingEvalPick, branching, simState, branchPreparing, playOutEvalChoice]);

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
  }, [branchTurn, history.length, editedP1Info, editedP2Info, markEvalStale]);

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

  // Opt-in: keep the branch evaluation fresh after each executed turn.
  useEffect(() => {
    if (branching && evaluation.prefs.auto && evaluation.status === 'stale' && !executing) {
      handleEvaluate();
    }
  }, [branching, evaluation.prefs.auto, evaluation.status, executing, handleEvaluate]);

  // "What if it had …": a team edit plus the normal branch refresh, with the
  // hypothetical move pre-seeded as that slot's pending choice.
  const handleHypotheticalMove = useCallback((
    side: 'p1' | 'p2',
    activeSlot: number,
    params: { species: string; move: string; replace: string | null },
  ) => {
    const sideInfo = side === 'p1' ? effectiveP1Info : effectiveP2Info;
    if (!sideInfo || !simState) return;

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
        p1Choices: seedChoices(simState.p1Choices ?? [], 'p1'),
        p2Choices: seedChoices(simState.p2Choices ?? [], 'p2'),
      });
    }
  }, [effectiveP1Info, effectiveP2Info, simState, history]);

  const handleExecuteTurn = useCallback(async () => {
    await executeTurn();
  }, [executeTurn]);

  const handleStopBranch = useCallback(() => {
    branchWindowOpenRef.current = false;
    stopBranch();
  }, [stopBranch]);

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

  // Programmatic seeks (graph clicks) race the embed's turn echoes: while
  // the iframe is still seeking it keeps reporting the OLD turn, which
  // would knock the fresh selection straight back (the analysis flipped
  // to the previous turn under load). Stale echoes are ignored until the
  // embed confirms the seek or the window lapses.
  const seekIntentRef = useRef<{ turn: number; until: number } | null>(null);

  const handleReplayTurn = useCallback((turn: number) => {
    if (branching || turn < 1) return;
    const intent = seekIntentRef.current;
    if (intent && Date.now() < intent.until) {
      if (turn !== intent.turn) return;
      seekIntentRef.current = null;
    }
    setBranchTurn(current => {
      // The embed can only report real turns; when the end position is
      // selected its echo (last turn) must not knock the slider back (B12).
      if (endSnapshotTurn !== null && current >= endSnapshotTurn && turn >= endSnapshotTurn - 1) {
        return current;
      }
      return turn;
    });
  }, [branching, endSnapshotTurn, setBranchTurn]);

  const handleGraphSelect = useCallback((turn: number) => {
    // Turn 0 (team preview) has no replay position — only the analysis opens.
    if (turn >= 1) {
      seekIntentRef.current = { turn, until: Date.now() + 4000 };
      // Direct, not via handleReplayTurn: an explicit selection beats the
      // echo guards (which exist to protect against the embed, not the user).
      setBranchTurn(turn);
    }
    setAnalysisTurn(turn);
  }, [setBranchTurn]);

  // The analysis follows the replay position — selecting a turn (slider,
  // graph click, stepping) IS the analysis request; there is no separate
  // "open" state. A lead selection (turn 0) survives until the slider moves.
  useEffect(() => {
    if (branching) return;
    setAnalysisTurn(prev => {
      const turn = Math.min(Math.max(1, branchTurn), analyzableTurns);
      return turn === prev ? prev : turn;
    });
  }, [branching, branchTurn, analyzableTurns]);

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
    if (branching) return evaluation.result;
    if (analysisTurn === 0) return evaluation.graph.lead?.result ?? null;
    if (analysisTurn !== null && analysisTurn >= 1) return evaluation.graph.results[analysisTurn - 1] ?? null;
    return null;
  }, [branching, evaluation.result, evaluation.graph, analysisTurn]);

  // What produced the shown result — the panel chip names it instead of
  // silently swapping numbers.
  const analyzedSettings = !branching && analysisTurn !== null && analysisTurn >= 1
    ? evaluation.graph.settings[analysisTurn - 1] ?? null
    : null;

  // The explicit deepening ladder: a sketch (or gap) first rises to the
  // configured settings, then one depth further (cap 3). Selecting a turn
  // never re-searches — this target is the only escalation.
  const thinkDeeperTarget = useMemo((): TurnEvalSettings | { mode: 'auto' } | null => {
    if (branching || analysisTurn === null || analysisTurn < 1) return null;
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
  }, [branching, analysisTurn, evaluation.graph.settings, evaluation.graph.faintedFractions, evaluation.prefs]);

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
    const analyses = results.map((result, index) => {
      const scoreBefore = scores[index];
      if (!result || scoreBefore === null) return null;
      return analyzeTurn({
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
      });
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
      ? 'None of the pasted Pokémon appear in this replay — the paste will be ignored for branching.'
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

  return (
    <div className="ps-app-root">
      {/* Header (hidden when framed by a host site) */}
      {!embed && (
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
                {usageStats.stats && (
                  <span style={{ fontSize: 10, color: '#b6a46a' }}>
                    Smogon {usageStats.stats.format} {usageStats.stats.month}
                  </span>
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
                      Branching — Turn {simState?.turnNumber ?? '…'}
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
                    <button type="button" className="ps-btn" onClick={handleStopBranch} style={{ padding: '2px 8px', fontSize: 10 }}>
                      Back
                    </button>
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
              {showBranch ? (
                <PSReplayFrame
                  key="branch"
                  log={simLog}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  title="Branch Simulation"
                  height={480}
                  seekTurn={simState?.turnNumber ?? branchTurn}
                  autoPlay={false}
                  viewpoint={replayData.viewpoint}
                  liveUpdates
                  liveAppendMode={animateBranchTurns ? 'play' : 'follow-end'}
                  liveAppendTurn={latestBranchHistoryEntry?.turnNumber ?? null}
                  reloadKey={`${branchSession}:${branchTurn}`}
                />
              ) : (
                <PSReplayFrame
                  key="replay"
                  log={replayData.log}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  height={480}
                  seekTurn={branchTurn}
                  autoPlay={false}
                  viewpoint={replayData.viewpoint}
                  reloadKey={`${replayData.id}:original`}
                  onTurnChange={handleReplayTurn}
                />
              )}
            </div>

            {/* Branch turn slider (below iframe, only when not branching) */}
            {!branching && (
              <div className="ps-branch-bar">
                <span style={{ fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap', color: '#cde' }}>Branch</span>
                <button
                  type="button"
                  onClick={() => setBranchTurn(t => Math.max(1, t - 1))}
                  disabled={branchTurn <= 1}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
                >&#9664;</button>
                <input
                  type="range"
                  min={1}
                  max={maxTurn}
                  value={branchTurn}
                  onChange={e => setBranchTurn(parseInt(e.target.value, 10))}
                  aria-label="Branch turn selector"
                />
                <button
                  type="button"
                  onClick={() => setBranchTurn(t => Math.min(maxTurn, t + 1))}
                  disabled={branchTurn >= maxTurn}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
                >&#9654;</button>
                <span style={{ fontSize: 11, color: '#aab', minWidth: 60, textAlign: 'center' }}>
                  {atEndPosition ? (
                    <strong style={{ color: '#fff' }}>End</strong>
                  ) : (
                    <>
                      T<strong style={{ color: '#fff' }}>{branchTurn}</strong>/{endSnapshotTurn !== null ? endSnapshotTurn - 1 : maxTurn}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className="ps-btn ps-btn-red"
                  onClick={handleBranch}
                  disabled={branchPreparing || atEndPosition}
                  title={atEndPosition ? 'The battle is already over at the end position — pick a turn to branch from.' : undefined}
                  style={{ padding: '3px 12px', fontSize: 11 }}
                >
                  {branchPreparing ? 'Preparing...' : 'Branch Here'}
                </button>
              </div>
            )}

            {branching ? (
              <>
                <BranchPanel
                  simState={simState}
                  executeError={executeError}
                  executing={executing}
                  gen={replayGen}
                  onSetChoice={handleSetChoice}
                  onHypotheticalMove={handleHypotheticalMove}
                  onExecuteTurn={handleExecuteTurn}
                />
                <BranchHistoryPanel
                  branchStartTurn={branchTurn}
                  history={history}
                  snapshots={snapshots}
                />
                <BranchSaveSharePanel
                  replayData={replayData}
                  branchTurn={branchTurn}
                  history={history}
                  finalLog={simLog}
                />
              </>
            ) : !embed ? (
              <>
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
              </>
            ) : null}
          </div>

          {/* Right column: evaluation beside the battle (chess-style), then stats */}
          <div className="ps-main-right">
            {evalAvailable && (
              <EvalPanel
                playerNames={[replayData.players[0], replayData.players[1]]}
                status={branching ? evaluation.status : 'idle'}
                result={analyzedResult}
                resultSettings={analyzedSettings}
                onThinkDeeper={!branching ? handleThinkDeeper : undefined}
                thinkDeeperTarget={!branching ? thinkDeeperTarget : null}
                smogonPending={usageStats.loading || setAssumptions.loading}
                progress={evaluation.progress}
                reconstructProgress={evaluation.reconstructProgress}
                error={evaluation.error}
                prefs={evaluation.prefs}
                onPrefsChange={evaluation.setPrefs}
                onEvaluate={branching ? handleEvaluate : undefined}
                onCancel={evaluation.cancel}
                onPickChoice={handleExploreChoice}
                onPickPair={handlePickPair}
                showAuto={branching}
                showTera={replayGen === 9}
                graph={evaluation.graph}
                onAnalyzeGame={!branching ? handleAnalyzeGame : undefined}
                onSelectTurn={!branching ? handleGraphSelect : undefined}
                currentTurn={branching ? (simState?.turnNumber ?? branchTurn) : branchTurn}
                analysis={!branching ? turnAnalysis : null}
                reads={!branching ? turnReads : null}
                leadAnalysis={!branching && analysisTurn === 0 ? leadAnalysisData : null}
                reportLeads={!branching ? leadAnalysisData : null}
                report={!branching ? gameReport : null}
                doubles={replayGameType === 'doubles'}
              />
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
