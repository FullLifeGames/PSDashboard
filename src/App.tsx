import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useReplay } from './hooks/useReplay';
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
import { parseTeamText } from './lib/team-parser';
import { enrichTeamInfo } from './lib/team-info';
import type { OpponentTeamInfo } from './types';
import { decodeBranchShare, type BranchSharePayload } from './lib/branch-share';
import { getBranchSimulatorFormat } from './lib/replay-format';

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
  const { loading, error, replayData, snapshots, opponentInfo, p1Info, loadReplay } = useReplay();
  const { branching, simState, history, startBranch, setChoice, executeTurn, stopBranch } = useBranch();
  const branchWindowOpenRef = useRef(false);
  const usageStats = useSmogonUsageStats(replayData?.formatid);
  const revealedSpecies = useMemo(() => {
    const p1 = p1Info?.pokemon.map(pokemon => pokemon.species) ?? [];
    const p2 = opponentInfo?.pokemon.map(pokemon => pokemon.species) ?? [];
    return [...new Set([...p1, ...p2])];
  }, [p1Info, opponentInfo]);
  const setAssumptions = useSmogonSetAssumptions(replayData?.formatid, revealedSpecies);

  const [teamText, setTeamText] = useState('');
  const [editorSide, setEditorSide] = useState<'p1' | 'p2' | null>(null);
  const [editedP1Info, setEditedP1Info] = useState<OpponentTeamInfo | null>(null);
  const [editedP2Info, setEditedP2Info] = useState<OpponentTeamInfo | null>(null);
  const [branchTurn, setBranchTurn] = useState(1);
  const [branchPreparing, setBranchPreparing] = useState(false);
  const [branchSession, setBranchSession] = useState(0);
  const [animateBranchTurns, setAnimateBranchTurns] = useState(true);
  const [sharedBranch, setSharedBranch] = useState<BranchSharePayload | null>(null);
  const [sharedBranchError, setSharedBranchError] = useState<string | null>(null);
  const [pendingBranchRefresh, setPendingBranchRefresh] = useState<{
    p1Info: OpponentTeamInfo;
    p2Info: OpponentTeamInfo;
    history: BranchHistoryEntry[];
    p1Choices: (string | null)[];
    p2Choices: (string | null)[];
  } | null>(null);

  const maxTurn = snapshots.length > 0 ? snapshots.length : 1;

  const handleTeamLoad = useCallback((rawText: string) => {
    const processed = parseTeamText(rawText);
    setTeamText(processed);
  }, []);

  const branchSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null;
    const idx = Math.min(branchTurn - 1, snapshots.length - 1);
    return snapshots[idx];
  }, [snapshots, branchTurn]);

  const effectiveP1Info = useMemo(() => {
    if (editedP1Info) return editedP1Info;
    return p1Info ? enrichTeamInfo(p1Info, usageStats.stats, setAssumptions.assumptions) : null;
  }, [editedP1Info, p1Info, usageStats.stats, setAssumptions.assumptions]);

  const effectiveP2Info = useMemo(() => {
    if (editedP2Info) return editedP2Info;
    return opponentInfo ? enrichTeamInfo(opponentInfo, usageStats.stats, setAssumptions.assumptions) : null;
  }, [editedP2Info, opponentInfo, usageStats.stats, setAssumptions.assumptions]);

  useEffect(() => {
    if (!replayData) return;
    void import('./lib/team-builder');
    void import('./lib/branch-engine');
  }, [replayData]);

  useEffect(() => {
    const match = window.location.hash.match(/^#branch=(.+)$/);
    if (!match) return;

    try {
      const decoded = decodeBranchShare(match[1]);
      if (decoded.version !== 1 || !decoded.finalLog || !decoded.replayId) {
        throw new Error('Unsupported branch share payload');
      }
      setSharedBranch(decoded);
      setSharedBranchError(null);
    } catch (error) {
      setSharedBranch(null);
      setSharedBranchError(error instanceof Error ? error.message : 'Unable to open shared branch');
    }
  }, []);

  const handleBranch = useCallback(async () => {
    if (!replayData || branchPreparing) return;
    setBranchPreparing(true);
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
        await startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, branchTurn, branchSnapshot);
        branchWindowOpenRef.current = true;
      }
    } finally {
      setBranchPreparing(false);
    }
  }, [replayData, branchPreparing, teamText, branchTurn, branchSnapshot, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, startBranch]);

  useEffect(() => {
    if (!pendingBranchRefresh || !replayData) return;

    let cancelled = false;
    const refreshRequest = pendingBranchRefresh;
    const activeReplay = replayData;

    async function refreshBranch() {
      setBranchPreparing(true);
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
          });
          branchWindowOpenRef.current = true;
        }
      } finally {
        if (!cancelled) {
          setBranchPreparing(false);
          setPendingBranchRefresh(null);
        }
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

  const handleSetChoice = useCallback((side: 'p1' | 'p2', choice: string, activeSlot?: number) => {
    setChoice(side, choice, activeSlot);
  }, [setChoice]);

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
    if (!branching && turn >= 1) {
      setBranchTurn(turn);
    }
  }, [branching]);

  const simLog = useMemo(() => {
    const raw = simState?.log ?? [];
    if (raw.length === 0) return '';
    return raw.filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|')).join('\n');
  }, [simState?.log]);
  const latestBranchHistoryEntry = history.length > 0 ? history[history.length - 1] : null;

  const showBranch = branching && simLog.length > 0;

  return (
    <div className="ps-app-root">
      {/* Header */}
      <div className="ps-app-header" style={{ borderRadius: '0 0 5px 5px' }}>
        <h1>PS Dashboard</h1>
        <span style={{ fontSize: 10, color: '#aabbcc' }}>
          Load a replay · branch off with different moves
        </span>
      </div>

      {!replayData && sharedBranch && (
        <SharedBranchView
          branch={sharedBranch}
          onLoadOriginal={handleLoadSharedOriginal}
          onClear={clearSharedBranch}
        />
      )}

      {!replayData && !sharedBranch && (
        <div style={{ marginTop: 8 }}>
          <ReplayLoader
            onLoad={loadReplay}
            onTeamLoad={handleTeamLoad}
            loading={loading}
            error={error}
            teamLoaded={teamText.length > 0}
            showGuide
          />
          {sharedBranchError && (
            <div className="ps-panel" style={{ marginTop: 8, color: '#f3a6a6', fontSize: 11 }}>
              Unable to open shared branch: {sharedBranchError}
            </div>
          )}
        </div>
      )}

      {replayData && (
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
                  <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fd6' }}>
                    Preparing branch...
                  </span>
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
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setBranchTurn(t => Math.min(maxTurn, t + 1))}
                  disabled={branchTurn >= maxTurn}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
                >&#9654;</button>
                <span style={{ fontSize: 11, color: '#aab', minWidth: 60, textAlign: 'center' }}>
                  T<strong style={{ color: '#fff' }}>{branchTurn}</strong>/{maxTurn}
                </span>
                <button
                  type="button"
                  className="ps-btn ps-btn-red"
                  onClick={handleBranch}
                  disabled={branchPreparing}
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
                  onSetChoice={handleSetChoice}
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
            ) : (
              <>
                <ReplayLoader
                  onLoad={loadReplay}
                  onTeamLoad={handleTeamLoad}
                  loading={loading}
                  error={error}
                  teamLoaded={teamText.length > 0}
                />
              </>
            )}
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

      {editorSide === 'p1' && effectiveP1Info && (
        <TeamEditor
          title="Edit Player Team"
          teamInfo={effectiveP1Info}
          onSave={(info) => handleSaveTeam('p1', info)}
          onClose={() => setEditorSide(null)}
        />
      )}

      {editorSide === 'p2' && effectiveP2Info && (
        <TeamEditor
          title="Edit Opponent Team"
          teamInfo={effectiveP2Info}
          onSave={(info) => handleSaveTeam('p2', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
    </div>
  );
}

export default App;
