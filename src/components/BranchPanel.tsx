import { useState, useMemo } from 'react';
import type { BranchSimState, BranchMoveOption, BranchSwitchOption } from '../hooks/useBranch';
import { calcDamageRanges, type DamageResult } from '../lib/damage-calc';

interface Props {
  simState: BranchSimState | null;
  onSetChoice: (side: 'p1' | 'p2', choice: string) => void;
  onExecuteTurn: () => void;
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

/* ── Main BranchPanel (controls only, no iframe) ── */
export function BranchPanel({ simState, onSetChoice, onExecuteTurn }: Props) {
  const [showLog, setShowLog] = useState(false);

  const p1Active = simState?.p1Active ?? null;
  const p2Active = simState?.p2Active ?? null;
  const p1Moves = simState?.p1Moves ?? [];
  const p2Moves = simState?.p2Moves ?? [];

  const p1Dmg = useMemo(() => {
    if (!p1Active || !p2Active || p1Moves.length === 0) return [];
    return calcDamageRanges(p1Active, p2Active, p1Moves);
  }, [p1Active, p2Active, p1Moves]);

  const p2Dmg = useMemo(() => {
    if (!p2Active || !p1Active || p2Moves.length === 0) return [];
    return calcDamageRanges(p2Active, p1Active, p2Moves);
  }, [p2Active, p1Active, p2Moves]);

  if (!simState) return null;

  const bothChosen = !!(simState.p1Choice && simState.p2Choice);
  const isForceSwitch = simState.p1ForceSwitch || simState.p2ForceSwitch;

  return (
    <div style={{ marginTop: 10 }}>
      {/* Controls — stacked vertically for P1 + P2 selection */}
      {!simState.ended && (
        <div style={{ borderRadius: 8, overflow: 'hidden', border: '2px solid #555' }}>
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

          {/* Execute turn button */}
          {!isForceSwitch && (
            <div style={{ background: '#333', padding: '0 12px 10px' }}>
              <button
                type="button"
                onClick={onExecuteTurn}
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
        </div>
      )}

      {/* Raw battle log toggle */}
      <div style={{ marginTop: 8 }}>
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
        {showLog && (
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
