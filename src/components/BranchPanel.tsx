import { useState, useCallback } from 'react';
import type { BranchSimState, SimPokemonInfo } from '../hooks/useBranch';

interface Props {
  currentTurn: number;
  onBranch: () => void;
  branching: boolean;
  simState: BranchSimState | null;
  onMakeChoice: (choice: string) => void;
  onStopBranch: () => void;
}

function getHpColor(percent: number): string {
  if (percent > 50) return 'bg-green-500';
  if (percent > 20) return 'bg-yellow-500';
  return 'bg-red-500';
}

function MiniPokemon({ info, isOpponent }: { info: SimPokemonInfo; isOpponent?: boolean }) {
  const id = info.species.toLowerCase().replace(/[^a-z0-9]/g, '');
  const spriteUrl = `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;

  return (
    <div className={`flex items-center gap-3 bg-[#0f3460] rounded-lg p-3 ${info.fainted ? 'opacity-40' : ''}`}>
      <img
        src={spriteUrl}
        alt={info.name}
        className={`w-14 h-14 object-contain ${isOpponent ? 'scale-x-[-1]' : ''}`}
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm truncate">{info.name}</span>
          {info.status && (
            <span className="text-[10px] px-1 rounded bg-purple-700">{info.status.toUpperCase()}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${getHpColor(info.hpPercent)} transition-all duration-300`}
              style={{ width: `${info.hpPercent}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400">{info.hpPercent}%</span>
        </div>
      </div>
    </div>
  );
}

export function BranchPanel({ currentTurn, onBranch, branching, simState, onMakeChoice, onStopBranch }: Props) {
  const [showLog, setShowLog] = useState(false);

  const handleMoveClick = useCallback((slot: number) => {
    onMakeChoice(`move ${slot}`);
  }, [onMakeChoice]);

  const handleSwitchClick = useCallback((slot: number) => {
    onMakeChoice(`switch ${slot}`);
  }, [onMakeChoice]);

  if (!branching) {
    return (
      <div className="bg-[#16213e] rounded-xl p-4 mt-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm">Branch from Turn {currentTurn}</h3>
            <p className="text-xs text-gray-400 mt-1">Try different moves from this point</p>
          </div>
          <button
            type="button"
            onClick={onBranch}
            className="bg-[#e94560] hover:bg-[#d63851] px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
          >
            Branch Here
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#16213e] rounded-xl p-4 mt-4 border border-[#e94560]/30">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm text-[#e94560]">
          Branching {simState ? `- Sim Turn ${simState.turnNumber}` : '...'}
        </h3>
        <div className="flex items-center gap-2">
          {simState?.ended && (
            <span className="text-xs px-2 py-1 rounded bg-green-900 text-green-300">
              Battle ended{simState.winner ? ` - ${simState.winner} wins!` : ''}
            </span>
          )}
          <button
            type="button"
            onClick={onStopBranch}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Mini battle view */}
      {simState && (
        <div className="mb-3 space-y-2">
          {/* Opponent active */}
          {simState.p2Active && (
            <MiniPokemon info={simState.p2Active} isOpponent />
          )}
          {/* Opponent bench */}
          <div className="flex gap-1 flex-wrap">
            {simState.p2Pokemon.filter(p => !p.isActive).map(p => (
              <span key={p.name} className={`text-[10px] px-1.5 py-0.5 rounded bg-[#0f3460] ${p.fainted ? 'opacity-30 line-through' : ''}`}>
                {p.species} {p.hpPercent}%
              </span>
            ))}
          </div>

          <div className="border-t border-[#1a1a5e] my-1" />

          {/* Player active */}
          {simState.p1Active && (
            <MiniPokemon info={simState.p1Active} />
          )}
          {/* Player bench */}
          <div className="flex gap-1 flex-wrap">
            {simState.p1Pokemon.filter(p => !p.isActive).map(p => (
              <span key={p.name} className={`text-[10px] px-1.5 py-0.5 rounded bg-[#0f3460] ${p.fainted ? 'opacity-30 line-through' : ''}`}>
                {p.species} {p.hpPercent}%
              </span>
            ))}
          </div>
        </div>
      )}

      {simState && !simState.ended && (
        <>
          {/* Force switch message */}
          {simState.forceSwitch && (
            <div className="mb-2 text-xs text-yellow-400">
              A Pokemon fainted! Choose who to send in:
            </div>
          )}

          {/* Move Selector */}
          {simState.p1Moves.length > 0 && (
            <div className="mb-3">
              <span className="text-xs text-gray-400 mb-1 block">Choose a move:</span>
              <div className="grid grid-cols-2 gap-2">
                {simState.p1Moves.map(move => (
                  <button
                    type="button"
                    key={move.slot}
                    onClick={() => handleMoveClick(move.slot)}
                    disabled={move.disabled}
                    className="bg-[#0f3460] hover:bg-[#1a1a5e] disabled:opacity-30 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                  >
                    <div className="font-medium">{move.name}</div>
                    <div className="text-[10px] text-gray-400">{move.pp}/{move.maxpp} PP</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Switch Selector */}
          {simState.p1Switches.length > 0 && (
            <div className="mb-3">
              <span className="text-xs text-gray-400 mb-1 block">
                {simState.forceSwitch ? 'Switch to:' : 'Or switch to:'}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {simState.p1Switches.map(sw => (
                  <button
                    type="button"
                    key={sw.slot}
                    onClick={() => handleSwitchClick(sw.slot)}
                    disabled={sw.fainted}
                    className="bg-[#0f3460] hover:bg-[#1a1a5e] disabled:opacity-30 px-3 py-2 rounded-lg text-xs text-left transition-colors"
                  >
                    <div className="font-medium">{sw.species}</div>
                    <div className="text-gray-400">{sw.hp}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Log viewer */}
      <button
        type="button"
        onClick={() => setShowLog(!showLog)}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        {showLog ? 'Hide' : 'Show'} Battle Log
      </button>
      {showLog && simState && (
        <div className="mt-2 bg-[#0f3460] rounded-lg p-3 max-h-60 overflow-y-auto">
          <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-mono">
            {simState.log
              .filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|') && !l.startsWith('|t:|'))
              .join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
