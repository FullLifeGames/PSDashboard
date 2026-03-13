import { useState, useCallback, useMemo } from 'react';
import { useReplay } from './hooks/useReplay';
import { useTimeline } from './hooks/useTimeline';
import { useBranch } from './hooks/useBranch';
import { ReplayLoader } from './components/ReplayLoader';
import { Timeline } from './components/Timeline';
import { BattleView } from './components/BattleView';
import { BranchPanel } from './components/BranchPanel';
import { OpponentEditor } from './components/OpponentEditor';
import { parseTeamText } from './lib/team-parser';
import { Teams } from '@pkmn/sim';
import type { OpponentTeamInfo } from './types';

function App() {
  const { loading, error, replayData, snapshots, opponentInfo, loadReplay } = useReplay();
  const maxTurn = snapshots.length > 0 ? snapshots.length : 1;
  const { currentTurn, goToTurn, nextTurn, prevTurn } = useTimeline(maxTurn);
  const { branching, simState, startBranch, makeChoice, stopBranch } = useBranch();

  const [teamText, setTeamText] = useState('');
  const [showOpponentEditor, setShowOpponentEditor] = useState(false);
  const [editedOpponentInfo, setEditedOpponentInfo] = useState<OpponentTeamInfo | null>(null);

  const currentSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null;
    const idx = Math.min(currentTurn - 1, snapshots.length - 1);
    return snapshots[idx];
  }, [snapshots, currentTurn]);

  const handleTeamLoad = useCallback((rawText: string) => {
    const processed = parseTeamText(rawText);
    setTeamText(processed);
  }, []);

  const handleBranch = useCallback(async () => {
    if (!currentSnapshot || !replayData) return;

    // Parse user's team if provided
    let p1Team = teamText ? Teams.import(teamText) : null;
    if (!p1Team || p1Team.length === 0) {
      // Build a minimal team from snapshot data
      p1Team = currentSnapshot.p1.pokemon.map(p => ({
        name: p.name,
        species: p.speciesForme,
        item: p.item || '',
        ability: p.ability || '',
        moves: p.moves.length > 0 ? p.moves : ['Tackle'],
        nature: 'Hardy' as const,
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        level: p.level || 100,
        gender: (p.gender || '') as '' | 'M' | 'F',
      }));
    }

    // Build opponent team from inferred/edited info
    const oppInfo = editedOpponentInfo || opponentInfo;
    const p2Team = oppInfo ? oppInfo.pokemon.map(p => ({
      name: p.species,
      species: p.species,
      item: p.item.includes('(') ? '' : p.item || '',
      ability: p.ability || '',
      moves: p.moves.length > 0 ? p.moves : ['Tackle'],
      nature: 'Hardy' as const,
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: p.level || 100,
      gender: (p.gender || '') as '' | 'M' | 'F',
    })) : [];

    if (p1Team.length > 0 && p2Team.length > 0) {
      await startBranch(
        replayData.formatid || 'gen9ou',
        p1Team,
        p2Team,
      );
    }
  }, [currentSnapshot, replayData, teamText, editedOpponentInfo, opponentInfo, startBranch]);

  const handleMakeChoice = useCallback(async (choice: string) => {
    await makeChoice(choice);
  }, [makeChoice]);

  const handleSaveOpponent = useCallback((info: OpponentTeamInfo) => {
    setEditedOpponentInfo(info);
    setShowOpponentEditor(false);
  }, []);

  const effectiveOpponentInfo = editedOpponentInfo || opponentInfo;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">PS Replay Interceptor</h1>
        <p className="text-sm text-gray-400">Load a replay, view any turn, branch off with different moves</p>
      </header>

      <ReplayLoader
        onLoad={loadReplay}
        onTeamLoad={handleTeamLoad}
        loading={loading}
        error={error}
        teamLoaded={teamText.length > 0}
      />

      {snapshots.length > 0 && (
        <>
          {replayData && (
            <div className="flex items-center gap-4 mb-4 text-sm">
              <span className="px-2 py-1 bg-[#0f3460] rounded text-xs">{replayData.format}</span>
              <span className="text-gray-400">
                {replayData.players[0]} vs {replayData.players[1]}
              </span>
              <button
                type="button"
                onClick={() => setShowOpponentEditor(true)}
                className="ml-auto text-xs text-gray-400 hover:text-[#e94560] transition-colors"
              >
                Edit Opponent Team
              </button>
            </div>
          )}

          <Timeline
            currentTurn={currentTurn}
            maxTurn={maxTurn}
            onTurnChange={goToTurn}
            onPrev={prevTurn}
            onNext={nextTurn}
          />

          {currentSnapshot && (
            <>
              <BattleView snapshot={currentSnapshot} />
              <BranchPanel
                currentTurn={currentTurn}
                onBranch={handleBranch}
                branching={branching}
                simState={simState}
                onMakeChoice={handleMakeChoice}
                onStopBranch={stopBranch}
              />
            </>
          )}

          {currentSnapshot && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-400 hover:text-white">
                Turn {currentSnapshot.turn} Protocol Log
              </summary>
              <div className="mt-2 bg-[#16213e] rounded-xl p-4 max-h-60 overflow-y-auto">
                <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-mono">
                  {currentSnapshot.log.filter(l => l.trim()).join('\n')}
                </pre>
              </div>
            </details>
          )}
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
