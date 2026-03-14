import { useState, useMemo, useRef } from 'react';
import type { BranchSimState, BranchMoveOption, BranchSwitchOption } from '../hooks/useBranch';
import type { ReplayData } from '../types';
import { PSReplayFrame } from './PSReplayFrame';
import { calcDamageRanges, type DamageResult } from '../lib/damage-calc';

interface Props {
  currentTurn: number;
  onBranch: () => void;
  branching: boolean;
  simState: BranchSimState | null;
  onSetChoice: (side: 'p1' | 'p2', choice: string) => void;
  onExecuteTurn: () => void;
  onStopBranch: () => void;
  replayData?: ReplayData;
}

/* ── PS type colors ── */
const TYPE_BG: Record<string, string> = {
  Normal:   '#A8A878', Fire:     '#F08030', Water:    '#6890F0',
  Electric: '#F8D030', Grass:    '#78C850', Ice:      '#98D8D8',
  Fighting: '#C03028', Poison:   '#A040A0', Ground:   '#E0C068',
  Flying:   '#A890F0', Psychic:  '#F85888', Bug:      '#A8B820',
  Rock:     '#B8A038', Ghost:    '#705898', Dragon:   '#7038F8',
  Dark:     '#705848', Steel:    '#B8B8D0', Fairy:    '#EE99AC',
  Stellar:  '#40B5A5', '???':    '#68A090',
};

function typeBg(type: string) { return TYPE_BG[type] || '#68A090'; }

function spriteUrl(species: string) {
  const id = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}

function hpBarClass(pct: number) {
  if (pct > 50) return 'ps-hpbar-green';
  if (pct > 20) return 'ps-hpbar-yellow';
  return 'ps-hpbar-red';
}

/* ── Move button ── */
function MoveBtn({ move, dmg, selected, onClick }: {
  move: BranchMoveOption; dmg?: DamageResult; selected: boolean; onClick: () => void;
}) {
  const bg = typeBg(move.type);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={move.disabled}
      className={`ps-movebtn ${selected ? 'ps-movebtn-selected' : ''}`}
      style={{ background: bg }}
    >
      <div className="ps-movebtn-name">{move.name}</div>
      <div className="ps-movebtn-info">
        <span className="ps-movebtn-type">{move.type || '???'}</span>
        <span className="ps-movebtn-pp">{move.pp}/{move.maxpp}</span>
      </div>
      {dmg && dmg.maxPercent > 0 && (
        <div className="ps-movebtn-dmg">
          {dmg.range}
          {dmg.koChance && <span className="ps-movebtn-ko"> ({dmg.koChance})</span>}
        </div>
      )}
    </button>
  );
}

/* ── Switch button ── */
function SwitchBtn({ sw, selected, onClick }: {
  sw: BranchSwitchOption; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sw.fainted}
      className={`ps-switchbtn ${selected ? 'ps-switchbtn-selected' : ''}`}
    >
      <img src={spriteUrl(sw.species)} alt={sw.name} />
      <div>
        <div className="ps-switchbtn-name">{sw.name}</div>
        <div style={{ width: 60 }}>
          <div className="ps-hpbar-track" style={{ height: 4, marginTop: 2 }}>
            <div className={`ps-hpbar-fill ${hpBarClass(sw.hpPercent)}`} style={{ width: `${sw.hpPercent}%` }} />
          </div>
        </div>
      </div>
      <span className="ps-switchbtn-hp">{sw.hp}</span>
    </button>
  );
}

/* ── Controls for one side (moves/switches) ── */
function SideControls({ label, activeName, moves, switches, forceSwitch, pending, dmgResults, onMove, onSwitch }: {
  label: string;
  activeName: string;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  forceSwitch: boolean;
  pending: string | null;
  dmgResults: DamageResult[];
  onMove: (slot: number) => void;
  onSwitch: (slot: number) => void;
}) {
  const [tab, setTab] = useState<'fight' | 'switch'>(forceSwitch ? 'switch' : 'fight');

  return (
    <div className="ps-controls" style={{ flex: 1 }}>
      <div className="ps-whatdo">
        <span style={{ color: '#888', fontSize: 10 }}>{label}</span>
        {' '}
        What will <strong>{activeName}</strong> do?
        {pending && (
          <span style={{ marginLeft: 8, fontSize: 10, color: '#6c6', fontFamily: 'monospace' }}>
            [{pending}]
          </span>
        )}
      </div>

      {forceSwitch && (
        <div style={{ fontSize: 11, color: '#fd6', marginBottom: 6, fontWeight: 'bold' }}>
          A Pokémon fainted! Choose who to send in:
        </div>
      )}

      {!forceSwitch && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <button
            type="button"
            className={`ps-controls-tab ${tab === 'fight' ? 'ps-controls-tab-active' : ''}`}
            onClick={() => setTab('fight')}
          >
            Fight
          </button>
          <button
            type="button"
            className={`ps-controls-tab ${tab === 'switch' ? 'ps-controls-tab-active' : ''}`}
            onClick={() => setTab('switch')}
          >
            Pokémon
          </button>
        </div>
      )}

      {!forceSwitch && tab === 'fight' && moves.length > 0 && (
        <div className="ps-movegrid">
          {moves.map((m, i) => (
            <MoveBtn
              key={m.slot}
              move={m}
              dmg={dmgResults[i]}
              selected={pending === `move ${m.slot}`}
              onClick={() => onMove(m.slot)}
            />
          ))}
        </div>
      )}

      {(forceSwitch || tab === 'switch') && switches.length > 0 && (
        <div className="ps-switchgrid">
          {switches.map(sw => (
            <SwitchBtn
              key={sw.slot}
              sw={sw}
              selected={pending === `switch ${sw.slot}`}
              onClick={() => onSwitch(sw.slot)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main BranchPanel ── */
export function BranchPanel({ currentTurn, onBranch, branching, simState, onSetChoice, onExecuteTurn, onStopBranch, replayData }: Props) {
  const [showLog, setShowLog] = useState(false);
  const [execCount, setExecCount] = useState(0);

  // Reset exec count when branching stops
  const prevBranching = useRef(branching);
  if (prevBranching.current && !branching) {
    setExecCount(0);
  }
  prevBranching.current = branching;

  const p1Active = simState?.p1Active ?? null;
  const p2Active = simState?.p2Active ?? null;
  const p1Moves = simState?.p1Moves ?? [];
  const p2Moves = simState?.p2Moves ?? [];
  const simLog_raw = simState?.log ?? [];

  const p1Dmg = useMemo(() => {
    if (!p1Active || !p2Active || p1Moves.length === 0) return [];
    return calcDamageRanges(p1Active, p2Active, p1Moves);
  }, [p1Active, p2Active, p1Moves]);

  const p2Dmg = useMemo(() => {
    if (!p2Active || !p1Active || p2Moves.length === 0) return [];
    return calcDamageRanges(p2Active, p1Active, p2Moves);
  }, [p2Active, p1Active, p2Moves]);

  // Build a clean protocol log for the PS replay iframe
  const simLog = useMemo(() => {
    if (simLog_raw.length === 0) return '';
    return simLog_raw
      .filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|'))
      .join('\n');
  }, [simLog_raw]);

  // Count actual |turn| markers in the log for reliable seeking
  const logTurnCount = useMemo(() => {
    return (simLog.match(/\|turn\|/g) || []).length;
  }, [simLog]);

  // Initial branch: seek to end (current turn), paused. After executing: seek to prev turn, play.
  const seekTurn = execCount === 0 ? logTurnCount : logTurnCount - 1;
  const autoPlay = execCount > 0;

  const handleExecuteTurn = () => {
    setExecCount(c => c + 1);
    onExecuteTurn();
  };

  /* ── Pre-branch state ── */
  if (!branching) {
    return (
      <div className="ps-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 'bold' }}>Branch from Turn {currentTurn}</div>
            <div style={{ fontSize: 11, color: '#8899aa', marginTop: 2 }}>Try different moves from this point</div>
          </div>
          <button type="button" className="ps-btn ps-btn-red" onClick={onBranch}>
            Branch Here
          </button>
        </div>
      </div>
    );
  }

  const bothChosen = !!(simState?.p1Choice && simState?.p2Choice);
  const isForceSwitch = simState?.p1ForceSwitch || simState?.p2ForceSwitch;

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '2px solid #8aa' }}>
      {/* Header bar */}
      <div style={{
        background: 'linear-gradient(180deg, #4a6a9c 0%, #3a5a8c 100%)',
        padding: '6px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>
          Branching {simState ? `— Turn ${simState.turnNumber}` : '…'}
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
          <button type="button" className="ps-btn" onClick={onStopBranch} style={{ padding: '3px 10px', fontSize: 10 }}>
            Reset
          </button>
        </div>
      </div>

      {/* PS Replay iframe showing the sim battle */}
      {simLog && (
        <PSReplayFrame
          log={simLog}
          format={replayData?.format}
          p1={replayData?.players[0] || 'Player 1'}
          p2={replayData?.players[1] || 'Player 2'}
          title="Branch Simulation"
          height={360}
          seekTurn={seekTurn}
          autoPlay={autoPlay}
        />
      )}

      {/* Controls — stacked vertically for P1 + P2 selection */}
      {simState && !simState.ended && (
        <div>
          <SideControls
            label="P1"
            activeName={simState.p1Active?.name || '???'}
            moves={simState.p1Moves}
            switches={simState.p1Switches}
            forceSwitch={simState.p1ForceSwitch}
            pending={simState.p1Choice}
            dmgResults={p1Dmg}
            onMove={(s) => onSetChoice('p1', `move ${s}`)}
            onSwitch={(s) => onSetChoice('p1', `switch ${s}`)}
          />
          <div style={{ height: 1, background: '#444' }} />
          <SideControls
            label="P2"
            activeName={simState.p2Active?.name || '???'}
            moves={simState.p2Moves}
            switches={simState.p2Switches}
            forceSwitch={simState.p2ForceSwitch}
            pending={simState.p2Choice}
            dmgResults={p2Dmg}
            onMove={(s) => onSetChoice('p2', `move ${s}`)}
            onSwitch={(s) => onSetChoice('p2', `switch ${s}`)}
          />
        </div>
      )}

      {/* Execute turn button */}
      {simState && !simState.ended && !isForceSwitch && (
        <div style={{ background: '#333', padding: '0 12px 10px' }}>
          <button
            type="button"
            onClick={handleExecuteTurn}
            disabled={!bothChosen}
            className="ps-execute-btn"
            style={{ background: bothChosen ? '#cc4455' : '#555' }}
          >
            {bothChosen
              ? 'Execute Turn'
              : `Select ${!simState.p1Choice ? 'P1' : ''}${!simState.p1Choice && !simState.p2Choice ? ' & ' : ''}${!simState.p2Choice ? 'P2' : ''} choice`
            }
          </button>
        </div>
      )}

      {/* Raw battle log toggle */}
      <div style={{ background: '#2a3a5c', padding: '6px 12px' }}>
        <button
          type="button"
          onClick={() => setShowLog(!showLog)}
          style={{
            background: 'none', border: 'none', color: '#889', cursor: 'pointer',
            fontSize: 10, fontFamily: 'inherit', padding: 0,
          }}
        >
          {showLog ? 'Hide' : 'Show'} Raw Protocol Log
        </button>
        {showLog && simState && (
          <div className="ps-log" style={{ marginTop: 6 }}>
            {simState.log
              .filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|') && !l.startsWith('|t:|'))
              .join('\n')}
          </div>
        )}
      </div>
    </div>
  );
}
