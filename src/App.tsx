import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useReplay } from './hooks/useReplay';
import { useBranch } from './hooks/useBranch';
import { ReplayLoader } from './components/ReplayLoader';
import { PSReplayFrame } from './components/PSReplayFrame';
import { BranchPanel } from './components/BranchPanel';
import { BattleStatsPanel } from './components/BattleStatsPanel';
import { OpponentEditor } from './components/OpponentEditor';
import { parseTeamText } from './lib/team-parser';
import { buildTeamsFromReplay } from './lib/team-builder';
import type { OpponentTeamInfo } from './types';

function App() {
  const { loading, error, replayData, snapshots, opponentInfo, p1Info, loadReplay } = useReplay();
  const { branching, simState, startBranch, setChoice, executeTurn, stopBranch } = useBranch();

  const [teamText, setTeamText] = useState('');
  const [showOpponentEditor, setShowOpponentEditor] = useState(false);
  const [editedOpponentInfo, setEditedOpponentInfo] = useState<OpponentTeamInfo | null>(null);
  const [branchTurn, setBranchTurn] = useState(1);
  const [execCount, setExecCount] = useState(0);

  const prevBranching = useRef(branching);
  useEffect(() => {
    if (prevBranching.current && !branching) {
      setExecCount(0);
    }
    prevBranching.current = branching;
  }, [branching]);

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

  const handleBranch = useCallback(async () => {
    if (!replayData) return;
    const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, teamText || undefined);
    if (p1Team.length > 0 && p2Team.length > 0) {
      await startBranch(replayData.formatid || 'gen9ou', p1Team, p2Team, replayData.log, branchTurn, branchSnapshot);
    }
  }, [replayData, teamText, branchTurn, branchSnapshot, startBranch]);

  const handleSetChoice = useCallback((side: 'p1' | 'p2', choice: string) => {
    setChoice(side, choice);
  }, [setChoice]);

  const handleExecuteTurn = useCallback(async () => {
    setExecCount(c => c + 1);
    await executeTurn();
  }, [executeTurn]);

  const handleSaveOpponent = useCallback((info: OpponentTeamInfo) => {
    setEditedOpponentInfo(info);
    setShowOpponentEditor(false);
  }, []);

  const effectiveOpponentInfo = editedOpponentInfo || opponentInfo;

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

  const logTurnCount = useMemo(() => (simLog.match(/\|turn\|/g) || []).length, [simLog]);
  const seekTurn = execCount === 0 ? logTurnCount : logTurnCount - 1;
  const autoPlay = execCount > 0;
  const showBranch = branching && simLog.length > 0;

  return (
    <div className="ps-app-root">
      {/* Header */}
      <div className="ps-app-header" style={{ borderRadius: '0 0 5px 5px' }}>
        <h1>PS Replay Interceptor</h1>
        <span style={{ fontSize: 10, color: '#aabbcc' }}>
          Load a replay · branch off with different moves
        </span>
      </div>

      {!replayData && (
        <div style={{ marginTop: 8 }}>
          <ReplayLoader
            onLoad={loadReplay}
            onTeamLoad={handleTeamLoad}
            loading={loading}
            error={error}
            teamLoaded={teamText.length > 0}
          />
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
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {showBranch && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
                      Branching — Turn {simState?.turnNumber ?? '…'}
                    </span>
                    {simState?.ended && (
                      <span className="ps-ended-tag">
                        {simState.winner ? `${simState.winner} wins!` : 'Ended'}
                      </span>
                    )}
                    <button type="button" className="ps-btn" onClick={stopBranch} style={{ padding: '2px 8px', fontSize: 10 }}>
                      Back
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowOpponentEditor(true)}
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
                  seekTurn={seekTurn}
                  autoPlay={autoPlay}
                />
              ) : (
                <PSReplayFrame
                  key="replay"
                  log={replayData.log}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  height={480}
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
                <button type="button" className="ps-btn ps-btn-red" onClick={handleBranch} style={{ padding: '3px 12px', fontSize: 11 }}>
                  Branch Here
                </button>
              </div>
            )}

            {branching ? (
              <BranchPanel
                simState={simState}
                onSetChoice={handleSetChoice}
                onExecuteTurn={handleExecuteTurn}
              />
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
              p1Info={p1Info}
              p2Info={effectiveOpponentInfo}
            />
          </div>
        </div>
      )}

      {showOpponentEditor && effectiveOpponentInfo && (
        <OpponentEditor
          opponentInfo={effectiveOpponentInfo}
          onSave={handleSaveOpponent}
          onClose={() => setShowOpponentEditor(false)}
        />
      )}
    </div>
  );
}

export default App;
