import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useReplay } from './hooks/useReplay';
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
import { TeamEditor } from './components/TeamEditor';
import { SetsImportExportPanel } from './components/SetsImportExportPanel';
import { EvalPanel } from './components/EvalPanel';
import { useEvaluation } from './hooks/useEvaluation';
import { buildSetsExport, parseSetsImport } from './lib/sets-io';
import { parseTeamText } from './lib/team-parser';
import { enrichTeamInfo, manualMove } from './lib/team-info';
import { applyPastedTeam, countMatchingSpecies, parsePastedTeam, type PastedSet } from './lib/team-paste';
import type { OpponentTeamInfo } from './types';
import { decodeBranchShare, type BranchSharePayload } from './lib/branch-share';
import { getBranchSimulatorFormat, getReplayGameType, getReplayGeneration } from './lib/replay-format';
import { choiceId, type BranchSlotChoice } from './lib/branch-choices';
import type { RankedChoice } from './lib/eval/types';

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
  const { loading, error, replayData, snapshots, opponentInfo, p1Info, loadReplay, loadReplayFile } = useReplay();
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
  const [branchTurn, setBranchTurn] = useState(1);
  const [branchPreparing, setBranchPreparing] = useState(false);
  const [branchProgress, setBranchProgress] = useState<{ turn: number; target: number } | null>(null);
  const branchAbortRef = useRef<AbortController | null>(null);
  const [branchSession, setBranchSession] = useState(0);
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
  }, [replayData?.id, stopBranch]);

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

  const effectiveP1Info = useMemo(() => {
    if (editedP1Info) return editedP1Info;
    const base = p1Info ? enrichTeamInfo(p1Info, usageStats.stats, setAssumptions.assumptions) : null;
    // A pasted team overlays the player's side as green "manual" data (G15).
    if (base && pastedSets && pastedSets.length > 0) {
      return applyPastedTeam(base, pastedSets).info;
    }
    return base;
  }, [editedP1Info, p1Info, usageStats.stats, setAssumptions.assumptions, pastedSets]);

  const effectiveP2Info = useMemo(() => {
    if (editedP2Info) return editedP2Info;
    return opponentInfo ? enrichTeamInfo(opponentInfo, usageStats.stats, setAssumptions.assumptions) : null;
  }, [editedP2Info, opponentInfo, usageStats.stats, setAssumptions.assumptions]);

  useEffect(() => {
    if (!replayData) return;
    void import('./lib/team-builder');
    void import('./lib/branch-engine');
  }, [replayData]);

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
      });
      if (p1Team.length > 0 && p2Team.length > 0) {
        setBranchSession(session => session + 1);
        await startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, branchTurn, branchSnapshot, {
          playerNames: [replayData.players[0], replayData.players[1]],
          onProgress: (turn, target) => setBranchProgress({ turn, target }),
          abort: abortController.signal,
        });
        if (!abortController.signal.aborted) {
          branchWindowOpenRef.current = true;
        }
      }
    } finally {
      setBranchPreparing(false);
      setBranchProgress(null);
      branchAbortRef.current = null;
    }
  }, [replayData, branchPreparing, teamText, branchTurn, branchSnapshot, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, startBranch]);

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
        });
        if (!cancelled && p1Team.length > 0 && p2Team.length > 0) {
          setBranchSession(session => session + 1);
          await startBranch(getBranchSimulatorFormat(activeReplay), p1Team, p2Team, activeReplay.log, branchTurn, branchSnapshot, {
            replayHistory: refreshRequest.history,
            p1Choices: refreshRequest.p1Choices,
            p2Choices: refreshRequest.p2Choices,
            playerNames: [activeReplay.players[0], activeReplay.players[1]],
            onProgress: (turn, target) => setBranchProgress({ turn, target }),
            abort: abortController.signal,
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
    teamText,
    branchTurn,
    branchSnapshot,
    usageStats.stats,
    setAssumptions.assumptions,
    startBranch,
  ]);

  const handleSetChoice = useCallback((side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => {
    setChoice(side, choice, activeSlot);
  }, [setChoice]);

  // ----- Position evaluation (singles only) -----
  const evalAvailable = useMemo(() => {
    if (!replayData) return false;
    const gameType = getReplayGameType(replayData.log);
    return gameType === null || gameType === 'singles';
  }, [replayData]);

  const setsFingerprint = useMemo(
    () => JSON.stringify([editedP1Info, editedP2Info, teamText]),
    [editedP1Info, editedP2Info, teamText],
  );

  const acquireBranchPosition = useCallback(async () => {
    const battle = getBattle();
    if (!battle) throw new Error('No live branch battle to evaluate.');
    const { serializeLiveBattle } = await import('./lib/eval/serialize');
    return serializeLiveBattle(battle);
  }, [getBattle]);

  const acquireReplayPosition = useCallback(async (reportReconstruct: (turn: number, target: number) => void) => {
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
    });
    if (p1Team.length === 0 || p2Team.length === 0) throw new Error('Could not build both teams for this replay.');
    const runtime = await branchEngine.reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replayData),
      p1Team,
      p2Team,
      replayLog: replayData.log,
      targetTurn: branchTurn,
      snapshot: branchSnapshot,
      playerNames: [replayData.players[0], replayData.players[1]],
      onProgress: reportReconstruct,
    });
    const invalid = branchEngine.validateBranchRuntime(runtime);
    if (invalid) throw new Error(invalid);
    const battle = runtime.battleStream.battle;
    if (!battle) throw new Error('Reconstruction produced no battle.');
    return serializeLiveBattle(battle);
  }, [replayData, teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, branchTurn, branchSnapshot]);

  const handleEvaluate = useCallback(() => {
    if (!replayData) return;
    if (branching) {
      evaluation.evaluate({ cacheKey: null, acquire: acquireBranchPosition });
    } else {
      evaluation.evaluate({
        cacheKey: `${replayData.id}:${branchTurn}:${setsFingerprint}`,
        acquire: acquireReplayPosition,
      });
    }
  }, [replayData, branching, evaluation, acquireBranchPosition, acquireReplayPosition, branchTurn, setsFingerprint]);

  // Clicking a recommended choice pre-fills the branch pickers.
  const handlePickEvalChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice) => {
    if (!simState) return;
    const parts = ranked.choice.split(' ');
    if (parts[0] === 'move') {
      const moves = side === 'p1' ? simState.p1MovesBySlot[0] : simState.p2MovesBySlot[0];
      const option = (moves ?? []).find(move => choiceId(move.name) === parts[1]);
      if (!option) return;
      handleSetChoice(side, {
        kind: 'move',
        moveId: choiceId(option.name),
        moveName: option.name,
        ...(parts[2] === 'terastallize' ? { modifier: 'terastallize' as const } : {}),
      });
    } else if (parts[0] === 'switch') {
      const slot = parseInt(parts[1], 10);
      const switches = side === 'p1' ? simState.p1SwitchesBySlot[0] : simState.p2SwitchesBySlot[0];
      const option = (switches ?? []).find(candidate => candidate.slot === slot);
      if (!option) return;
      handleSetChoice(side, { kind: 'switch', speciesId: choiceId(option.species), pokemonName: option.name });
    }
  }, [simState, handleSetChoice]);

  // Any position change invalidates a displayed result.
  const { markStale: markEvalStale, reset: resetEval } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [branchTurn, history.length, editedP1Info, editedP2Info, markEvalStale]);

  // A different replay or entering/leaving branch mode is a new position context.
  useEffect(() => {
    resetEval();
  }, [replayData?.id, branching, resetEval]);

  // Opt-in: keep the branch evaluation fresh after each executed turn.
  useEffect(() => {
    if (branching && evaluation.panelOpen && evaluation.prefs.auto && evaluation.status === 'stale' && !executing) {
      handleEvaluate();
    }
  }, [branching, evaluation.panelOpen, evaluation.prefs.auto, evaluation.status, executing, handleEvaluate]);

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

  const handleReplayTurn = useCallback((turn: number) => {
    if (branching || turn < 1) return;
    setBranchTurn(current => {
      // The embed can only report real turns; when the end position is
      // selected its echo (last turn) must not knock the slider back (B12).
      if (endSnapshotTurn !== null && current >= endSnapshotTurn && turn >= endSnapshotTurn - 1) {
        return current;
      }
      return turn;
    });
  }, [branching, endSnapshotTurn]);

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
                    {evalAvailable && (
                      <button
                        type="button"
                        className="ps-btn"
                        onClick={evaluation.togglePanel}
                        style={{ padding: '2px 8px', fontSize: 10 }}
                      >
                        Eval
                      </button>
                    )}
                    <button type="button" className="ps-btn" onClick={handleStopBranch} style={{ padding: '2px 8px', fontSize: 10 }}>
                      Back
                    </button>
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
                {evalAvailable && (
                  <button
                    type="button"
                    className="ps-btn"
                    onClick={evaluation.togglePanel}
                    disabled={atEndPosition}
                    title={atEndPosition ? 'The battle is already over at the end position.' : 'Toggle the position evaluation panel.'}
                    style={{ padding: '3px 12px', fontSize: 11 }}
                  >
                    Eval
                  </button>
                )}
              </div>
            )}

            {evaluation.panelOpen && evalAvailable && replayData && (
              <EvalPanel
                playerNames={[replayData.players[0], replayData.players[1]]}
                status={evaluation.status}
                result={evaluation.result}
                progress={evaluation.progress}
                reconstructProgress={evaluation.reconstructProgress}
                error={evaluation.error}
                prefs={evaluation.prefs}
                onPrefsChange={evaluation.setPrefs}
                onEvaluate={handleEvaluate}
                onCancel={evaluation.cancel}
                onPickChoice={branching ? handlePickEvalChoice : undefined}
                showAuto={branching}
              />
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
                  teamStatus={teamPasteStatus}
                  teamError={teamPasteError || teamPasteMismatch}
                />
              </>
            ) : null}
          </div>

          {/* Right column: controls + stats */}
          <div className="ps-main-right">
            <BattleStatsPanel
              replayData={replayData}
              p1Info={effectiveP1Info}
              p2Info={effectiveP2Info}
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
