import { useState, useCallback, useMemo } from 'react';
import { useReplay } from './hooks/useReplay';
import { useBranch } from './hooks/useBranch';
import { ReplayLoader } from './components/ReplayLoader';
import { PSReplayFrame } from './components/PSReplayFrame';
import { BranchPanel } from './components/BranchPanel';
import { OpponentEditor } from './components/OpponentEditor';
import { parseTeamText } from './lib/team-parser';
import { buildTeamsFromReplay } from './lib/team-builder';
import type { OpponentTeamInfo } from './types';

function App() {
  const { loading, error, replayData, snapshots, opponentInfo, loadReplay } = useReplay();
  const { branching, simState, startBranch, setChoice, executeTurn, stopBranch } = useBranch();

  const [teamText, setTeamText] = useState('');
  const [showOpponentEditor, setShowOpponentEditor] = useState(false);
  const [editedOpponentInfo, setEditedOpponentInfo] = useState<OpponentTeamInfo | null>(null);
  const [branchTurn, setBranchTurn] = useState(1);

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

    // Build teams from the replay's actual pokemon, augmented with
    // user's pasted team (for p1 full movesets/EVs) and common sets (for p2)
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
    await executeTurn();
  }, [executeTurn]);

  const handleSaveOpponent = useCallback((info: OpponentTeamInfo) => {
    setEditedOpponentInfo(info);
    setShowOpponentEditor(false);
  }, []);

  const effectiveOpponentInfo = editedOpponentInfo || opponentInfo;

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
            <button
              type="button"
              onClick={() => setShowOpponentEditor(true)}
              className="ps-btn"
              style={{ padding: '2px 10px', fontSize: 10 }}
            >
              Edit Opponent
            </button>
          </div>

          {/* Replay iframe */}
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '2px solid #5a7aac', marginBottom: 10 }}>
            <PSReplayFrame
              log={replayData.log}
              format={replayData.format}
              p1={replayData.players[0]}
              p2={replayData.players[1]}
              height={540}
            />
          </div>

          {/* Branch turn selector */}
          <div className="ps-panel" style={{ marginBottom: 10 }}>
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
            </div>
          </div>

          {/* Branch panel (controls + sim iframe) */}
          <BranchPanel
            currentTurn={branchTurn}
            onBranch={handleBranch}
            branching={branching}
            simState={simState}
            onSetChoice={handleSetChoice}
            onExecuteTurn={handleExecuteTurn}
            onStopBranch={stopBranch}
            replayData={replayData}
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
