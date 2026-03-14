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

  // Reset exec count when branching stops
  const prevBranching = useRef(branching);
  useEffect(() => {
    if (prevBranching.current && !branching) {
      setExecCount(0);
    }
    prevBranching.current = branching;
  }, [branching]);

  // Total turns from parsed snapshots
  const maxTurn = snapshots.length > 0 ? snapshots.length : 1;

  const handleTeamLoad = useCallback((rawText: string) => {
    const processed = parseTeamText(rawText);
    setTeamText(processed);
  }, []);

  // Get the snapshot at the chosen branch turn
  const branchSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null;
    const idx = Math.min(branchTurn - 1, snapshots.length - 1);
    return snapshots[idx];
  }, [snapshots, branchTurn]);

  const handleBranch = useCallback(async () => {
    if (!replayData) return;
    const { p1Team, p2Team } = buildTeamsFromReplay(
      replayData.log,
      teamText || undefined,
    );
    if (p1Team.length > 0 && p2Team.length > 0) {
      await startBranch(
        replayData.formatid || 'gen9ou',
        p1Team,
        p2Team,
        replayData.log,
        branchTurn,
        branchSnapshot,
      );
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

  // Sync branch turn slider with the replay's current turn
  const handleReplayTurn = useCallback((turn: number) => {
    if (!branching && turn >= 1) {
      setBranchTurn(turn);
    }
  }, [branching]);

  // Build sim log for the branch iframe
  const simLog = useMemo(() => {
    const raw = simState?.log ?? [];
    if (raw.length === 0) return '';
    return raw
      .filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|'))
      .join('\n');
  }, [simState?.log]);

  // Seek logic for the branch iframe
  const logTurnCount = useMemo(() => {
    return (simLog.match(/\|turn\|/g) || []).length;
  }, [simLog]);
  const seekTurn = execCount === 0 ? logTurnCount : logTurnCount - 1;
  const autoPlay = execCount > 0;

  // Which log to show in the single iframe
  const showBranch = branching && simLog.length > 0;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 12px 24px' }}>
      {/* Header */}
      <div className="ps-app-header" style={{ marginBottom: 10, borderRadius: '0 0 5px 5px' }}>
        <h1>PS Replay Interceptor</h1>
        <span style={{ fontSize: 10, color: '#aabbcc' }}>
          Load a replay · branch off with different moves
        </span>
      </div>

      <ReplayLoader
        onLoad={loadReplay}
        onTeamLoad={handleTeamLoad}
        loading={loading}
        error={error}
        teamLoaded={teamText.length > 0}
      />

      {replayData && (
        <>
          {/* Match info bar */}
          <div className="ps-panel" style={{
            marginBottom: 10, padding: '6px 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 3,
                background: 'rgba(100,140,200,0.3)', color: '#aac',
              }}>
                {replayData.format}
              </span>
              <span style={{ fontSize: 11, color: '#8ac' }}>{replayData.players[0]}</span>
              <span style={{ fontSize: 10, color: '#556' }}>vs</span>
              <span style={{ fontSize: 11, color: '#c8a' }}>{replayData.players[1]}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setShowOpponentEditor(true)}
                className="ps-btn"
                style={{ padding: '2px 10px', fontSize: 10 }}
              >
                Edit Opponent
              </button>
            </div>
          </div>

          {/* Single unified iframe — shows replay OR branch sim */}
          <div style={{ borderRadius: 8, overflow: 'hidden', border: `2px solid ${showBranch ? '#8aa' : '#5a7aac'}` }}>
            {/* Branch header bar (only when branching) */}
            {showBranch && (
              <div style={{
                background: 'linear-gradient(180deg, #4a6a9c 0%, #3a5a8c 100%)',
                padding: '6px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>
                  Branching — Turn {simState?.turnNumber ?? '…'}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {simState?.ended && (
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: '#1b5e20', color: '#a5d6a7', fontWeight: 'bold',
                    }}>
                      {simState.winner ? `${simState.winner} wins!` : 'Battle ended'}
                    </span>
                  )}
                  <button type="button" className="ps-btn" onClick={stopBranch} style={{ padding: '3px 10px', fontSize: 10 }}>
                    Back to Replay
                  </button>
                </div>
              </div>
            )}

            {showBranch ? (
              <PSReplayFrame
                key="branch"
                log={simLog}
                format={replayData.format}
                p1={replayData.players[0]}
                p2={replayData.players[1]}
                title="Branch Simulation"
                height={540}
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
                height={540}
                onTurnChange={handleReplayTurn}
              />
            )}
          </div>

          {/* Branch controls below the iframe */}
          {!branching ? (
            /* Turn selector + Branch Here */
            <div className="ps-panel" style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 'bold', whiteSpace: 'nowrap' }}>Branch Point</div>
                <button
                  type="button"
                  onClick={() => setBranchTurn(t => Math.max(1, t - 1))}
                  disabled={branchTurn <= 1}
                  className="ps-btn"
                  style={{ padding: '4px 10px', fontSize: 14, lineHeight: 1 }}
                >
                  &#9664;
                </button>
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
                  style={{ padding: '4px 10px', fontSize: 14, lineHeight: 1 }}
                >
                  &#9654;
                </button>
                <span style={{ fontSize: 11, color: '#aab', minWidth: 80, textAlign: 'center' }}>
                  Turn <strong style={{ color: '#fff' }}>{branchTurn}</strong> / {maxTurn}
                </span>
                <button type="button" className="ps-btn ps-btn-red" onClick={handleBranch}>
                  Branch Here
                </button>
              </div>
            </div>
          ) : (
            /* Move/switch controls when branching */
            <BranchPanel
              simState={simState}
              onSetChoice={handleSetChoice}
              onExecuteTurn={handleExecuteTurn}
            />
          )}

          {/* Battle Statistics */}
          <BattleStatsPanel
            replayData={replayData}
            p1Info={p1Info}
            p2Info={effectiveOpponentInfo}
          />
        </>
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
