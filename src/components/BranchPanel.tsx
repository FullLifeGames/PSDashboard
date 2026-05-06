import { useEffect, useState, useMemo } from 'react';
import type { BranchSimState, BranchMoveOption, BranchSwitchOption } from '../hooks/useBranch';
import type { DamageResult } from '../lib/damage-calc';
import {
  branchSideChoicesReady,
  requiredChoicesForActiveSlots,
  switchTarget,
} from '../lib/branch-choices';

interface Props {
  simState: BranchSimState | null;
  onSetChoice: (side: 'p1' | 'p2', choice: string, activeSlot?: number) => void;
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
const EMPTY_MOVES: BranchMoveOption[] = [];
const EMPTY_SWITCHES: BranchSwitchOption[] = [];

function typeBg(type: string) { return TYPE_BG[type] || '#68A090'; }

interface MoveRecommendation {
  move: BranchMoveOption;
  targetLoc?: number;
  range?: string;
  score: number;
}

function pickRecommendedMove(
  moves: BranchMoveOption[],
  defaultDamage: DamageResult[],
  targetDamage: Record<string, DamageResult | undefined>,
): MoveRecommendation | null {
  let best: MoveRecommendation | null = null;

  moves.forEach((move, index) => {
    if (move.disabled || (move.requiresTarget && move.targetOptions.length === 0)) return;

    const candidates = move.targetOptions.length > 0
      ? move.targetOptions.map(target => ({
        move,
        targetLoc: target.targetLoc,
        damage: targetDamage[`${move.slot}:${target.targetLoc}`],
      }))
      : [{ move, targetLoc: undefined, damage: defaultDamage[index] }];

    for (const candidate of candidates) {
      const score = candidate.damage?.maxPercent ?? 0;
      if (!best || score > best.score) {
        best = {
          move: candidate.move,
          targetLoc: candidate.targetLoc,
          range: candidate.damage?.range,
          score,
        };
      }
    }
  });

  return best;
}

function spriteUrl(species: string) {
  const id = species.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}

function hpBarClass(pct: number) {
  if (pct > 50) return 'ps-hpbar-green';
  if (pct > 20) return 'ps-hpbar-yellow';
  return 'ps-hpbar-red';
}

/* ── Move button ── */
function MoveBtn({ move, dmg, targetDamage, selected, onClick }: {
  move: BranchMoveOption;
  dmg?: DamageResult;
  targetDamage: Record<number, DamageResult | undefined>;
  selected: boolean;
  onClick: (targetLoc?: number) => void;
}) {
  const bg = typeBg(move.type);
  return (
    <div>
      <button
        type="button"
        onClick={() => onClick(move.targetOptions[0]?.targetLoc)}
        disabled={move.disabled || (move.requiresTarget && move.targetOptions.length === 0)}
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
      {move.targetOptions.length > 0 && (
        <div className="ps-target-row">
          {move.targetOptions.map(target => (
            <button
              key={target.targetLoc}
              type="button"
              onClick={() => onClick(target.targetLoc)}
              disabled={move.disabled}
              className="ps-target-btn"
              title={`${move.name} into ${target.name} (${target.hpPercent}%)`}
            >
              {target.label}
              {targetDamage[target.targetLoc]?.maxPercent ? ` ${targetDamage[target.targetLoc]?.range}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Switch button ── */
function SwitchBtn({ sw, selected, disabled, onClick }: {
  sw: BranchSwitchOption; selected: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sw.fainted || disabled}
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
function SideControls({ label, activeName, moves, switches, forceSwitch, pending, blockedSwitchSlots, dmgResults, targetDamageResults, onMove, onSwitch, onRawChoice }: {
  label: string;
  activeName: string;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  forceSwitch: boolean;
  pending: string | null;
  blockedSwitchSlots: Set<number>;
  dmgResults: DamageResult[];
  targetDamageResults: Record<string, DamageResult | undefined>;
  onMove: (slot: number, targetLoc?: number) => void;
  onSwitch: (slot: number) => void;
  onRawChoice: (choice: string) => void;
}) {
  const [tab, setTab] = useState<'fight' | 'switch'>(forceSwitch ? 'switch' : 'fight');
  const [customChoice, setCustomChoice] = useState('');
  const recommendation = useMemo(
    () => pickRecommendedMove(moves, dmgResults, targetDamageResults),
    [moves, dmgResults, targetDamageResults],
  );

  return (
    <div className="ps-controls ps-side-controls">
      <div className="ps-whatdo">
        <span className="ps-side-label">{label}</span>
        {' '}
        What will <strong>{activeName}</strong> do?
        {pending && (
          <span className="ps-pending-choice">
            [{pending}]
          </span>
        )}
      </div>

      {forceSwitch && (
        <div className="ps-force-switch-note">
          A Pokémon fainted! Choose who to send in:
        </div>
      )}

      {!forceSwitch && (
        <div className="ps-tab-row">
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
        <>
          {recommendation && (
            <button
              type="button"
              className="ps-recommendation-btn"
              onClick={() => onMove(recommendation.move.slot, recommendation.targetLoc)}
            >
              <span className="ps-recommendation-label">Use Recommended</span>
              <span className="ps-recommendation-move">
                {recommendation.move.name}
                {recommendation.range && recommendation.range !== '-' ? ` ${recommendation.range}` : ''}
              </span>
            </button>
          )}
          <div className="ps-movegrid">
            {moves.map((m, i) => (
              <MoveBtn
                key={m.slot}
                move={m}
                dmg={dmgResults[i]}
                targetDamage={Object.fromEntries(
                  m.targetOptions.map(target => [
                    target.targetLoc,
                    targetDamageResults[`${m.slot}:${target.targetLoc}`],
                  ]),
                )}
                selected={pending?.startsWith(`move ${m.slot}`) ?? false}
                onClick={(targetLoc) => onMove(m.slot, targetLoc)}
              />
            ))}
          </div>
          <div className="ps-custom-choice">
            <input
              type="text"
              className="ps-input"
              aria-label={`Custom move choice for ${label}`}
              value={customChoice}
              onChange={event => setCustomChoice(event.target.value)}
              placeholder="Custom: move 1, move thunderbolt, move 2 +1"
            />
            <button
              type="button"
              className="ps-btn"
              disabled={!customChoice.trim()}
              onClick={() => onSetChoiceFromCustom(customChoice)}
            >
              Use Custom
            </button>
          </div>
        </>
      )}

      {(forceSwitch || tab === 'switch') && switches.length > 0 && (
        <div className="ps-switchgrid">
          {switches.map(sw => (
            <SwitchBtn
              key={sw.slot}
              sw={sw}
              selected={pending === `switch ${sw.slot}`}
              disabled={blockedSwitchSlots.has(sw.slot) && pending !== `switch ${sw.slot}`}
              onClick={() => onSwitch(sw.slot)}
            />
          ))}
        </div>
      )}
    </div>
  );

  function onSetChoiceFromCustom(choice: string) {
    const trimmed = choice.trim();
    if (!trimmed) return;
    onMoveChoice(trimmed);
  }

  function onMoveChoice(choice: string) {
    const match = choice.match(/^move\s+(\d+)(?:\s+([+-]?\d+))?$/i);
    if (match) {
      onMove(parseInt(match[1], 10), match[2] ? parseInt(match[2], 10) : undefined);
      return;
    }
    onRawChoice(choice);
  }
}

/* ── Main BranchPanel (controls only, no iframe) ── */
export function BranchPanel({ simState, onSetChoice, onExecuteTurn }: Props) {
  const [showLog, setShowLog] = useState(false);
  const [damageBySide, setDamageBySide] = useState<{
    p1: { default: DamageResult[][]; targets: Record<number, Record<string, DamageResult | undefined>> };
    p2: { default: DamageResult[][]; targets: Record<number, Record<string, DamageResult | undefined>> };
  }>({
    p1: { default: [], targets: {} },
    p2: { default: [], targets: {} },
  });

  const p1ActiveSlots = useMemo(
    () => simState?.p1ActiveSlots ?? (simState?.p1Active ? [simState.p1Active] : []),
    [simState],
  );
  const p2ActiveSlots = useMemo(
    () => simState?.p2ActiveSlots ?? (simState?.p2Active ? [simState.p2Active] : []),
    [simState],
  );
  const p1MovesBySlot = useMemo(
    () => simState?.p1MovesBySlot ?? [simState?.p1Moves ?? EMPTY_MOVES],
    [simState],
  );
  const p2MovesBySlot = useMemo(
    () => simState?.p2MovesBySlot ?? [simState?.p2Moves ?? EMPTY_MOVES],
    [simState],
  );
  const p1SwitchesBySlot = simState?.p1SwitchesBySlot ?? [simState?.p1Switches ?? EMPTY_SWITCHES];
  const p2SwitchesBySlot = simState?.p2SwitchesBySlot ?? [simState?.p2Switches ?? EMPTY_SWITCHES];
  const firstP1Target = p2ActiveSlots.find(Boolean) ?? null;
  const firstP2Target = p1ActiveSlots.find(Boolean) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function calculatePreviewDamage() {
      const { calcDamageRanges, calcSingleDamageRange } = await import('../lib/damage-calc');
      if (cancelled) return;

      const targetBySideSlot = {
        p1: new Map(p1ActiveSlots.map((active, index) => [`p1:${index}`, active])),
        p2: new Map(p2ActiveSlots.map((active, index) => [`p2:${index}`, active])),
      };
      const damageContext = {
        gameType: p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1 ? 'Doubles' as const : 'Singles' as const,
      };

      const p1Default = p1ActiveSlots.map((active, slot) => {
        const moves = p1MovesBySlot[slot] ?? EMPTY_MOVES;
        if (!active || !firstP1Target || moves.length === 0) return [];
        return calcDamageRanges(active, firstP1Target, moves, damageContext);
      });
      const p2Default = p2ActiveSlots.map((active, slot) => {
        const moves = p2MovesBySlot[slot] ?? EMPTY_MOVES;
        if (!active || !firstP2Target || moves.length === 0) return [];
        return calcDamageRanges(active, firstP2Target, moves, damageContext);
      });

      const makeTargetDamage = (
        activeSlots: typeof p1ActiveSlots,
        movesBySlot: BranchMoveOption[][],
      ) => Object.fromEntries(activeSlots.map((active, activeSlot) => {
        const moves = movesBySlot[activeSlot] ?? EMPTY_MOVES;
        if (!active || moves.length === 0) return [activeSlot, {}];
        const entries: [string, DamageResult][] = [];
        for (const move of moves) {
          for (const target of move.targetOptions) {
            const defender = targetBySideSlot[target.side].get(`${target.side}:${target.activeSlot}`);
            if (defender) {
              entries.push([`${move.slot}:${target.targetLoc}`, calcSingleDamageRange(active, defender, move, damageContext)]);
            }
          }
        }
        return [activeSlot, Object.fromEntries(entries)];
      }));

      if (!cancelled) {
        setDamageBySide({
          p1: { default: p1Default, targets: makeTargetDamage(p1ActiveSlots, p1MovesBySlot) },
          p2: { default: p2Default, targets: makeTargetDamage(p2ActiveSlots, p2MovesBySlot) },
        });
      }
    }

    void calculatePreviewDamage();
    return () => {
      cancelled = true;
    };
  }, [p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, firstP1Target, firstP2Target]);

  if (!simState) return null;

  const isForceSwitch = simState.p1ForceSwitch || simState.p2ForceSwitch;
  const isMultiActive = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1;
  const moveChoice = (slot: number, targetLoc?: number) =>
    targetLoc ? `move ${slot} ${targetLoc > 0 ? '+' : ''}${targetLoc}` : `move ${slot}`;
  const p1RequiredChoices = requiredChoicesForActiveSlots(p1ActiveSlots, simState.p1ForceSwitches);
  const p2RequiredChoices = requiredChoicesForActiveSlots(p2ActiveSlots, simState.p2ForceSwitches);
  const bothChosen = branchSideChoicesReady(simState.p1Choices, p1RequiredChoices) &&
    branchSideChoicesReady(simState.p2Choices, p2RequiredChoices);
  const blockedSwitchSlots = (choices: (string | null)[], activeSlot: number) => {
    const blocked = new Set<number>();
    choices.forEach((choice, index) => {
      if (index === activeSlot) return;
      const target = switchTarget(choice);
      if (target !== null) blocked.add(target);
    });
    return blocked;
  };
  const pendingLabel = bothChosen
    ? 'Execute Turn'
    : isMultiActive
      ? 'Select all active choices'
      : `Select ${!simState.p1Choice ? 'P1' : ''}${!simState.p1Choice && !simState.p2Choice ? ' & ' : ''}${!simState.p2Choice ? 'P2' : ''} choice`;

  return (
    <div>
      {/* Controls — stacked vertically for P1 + P2 selection */}
      {!simState.ended && (
        <div className="ps-branch-controls-shell">
          <div className="ps-branch-controls-grid">
            <div className="ps-branch-side-column">
              {p1ActiveSlots.map((active, slot) => (
                <SideControls
                  key={`p1-${slot}`}
                  label={p1ActiveSlots.length > 1 ? `P1${String.fromCharCode(65 + slot)}` : 'P1'}
                  activeName={active?.name || '???'}
                  moves={p1MovesBySlot[slot] ?? EMPTY_MOVES}
                  switches={p1SwitchesBySlot[slot] ?? EMPTY_SWITCHES}
                  forceSwitch={simState.p1ForceSwitches[slot] ?? false}
                  pending={simState.p1Choices[slot] ?? null}
                  blockedSwitchSlots={blockedSwitchSlots(simState.p1Choices, slot)}
                  dmgResults={damageBySide.p1.default[slot] ?? []}
                  targetDamageResults={damageBySide.p1.targets[slot] ?? {}}
                  onMove={(s, targetLoc) => onSetChoice('p1', moveChoice(s, targetLoc), slot)}
                  onSwitch={(s) => onSetChoice('p1', `switch ${s}`, slot)}
                  onRawChoice={(choice) => onSetChoice('p1', choice, slot)}
                />
              ))}
            </div>
            <div className="ps-side-divider" />
            <div className="ps-branch-side-column">
              {p2ActiveSlots.map((active, slot) => (
                <SideControls
                  key={`p2-${slot}`}
                  label={p2ActiveSlots.length > 1 ? `P2${String.fromCharCode(65 + slot)}` : 'P2'}
                  activeName={active?.name || '???'}
                  moves={p2MovesBySlot[slot] ?? EMPTY_MOVES}
                  switches={p2SwitchesBySlot[slot] ?? EMPTY_SWITCHES}
                  forceSwitch={simState.p2ForceSwitches[slot] ?? false}
                  pending={simState.p2Choices[slot] ?? null}
                  blockedSwitchSlots={blockedSwitchSlots(simState.p2Choices, slot)}
                  dmgResults={damageBySide.p2.default[slot] ?? []}
                  targetDamageResults={damageBySide.p2.targets[slot] ?? {}}
                  onMove={(s, targetLoc) => onSetChoice('p2', moveChoice(s, targetLoc), slot)}
                  onSwitch={(s) => onSetChoice('p2', `switch ${s}`, slot)}
                  onRawChoice={(choice) => onSetChoice('p2', choice, slot)}
                />
              ))}
            </div>
          </div>

          {/* Execute turn button */}
          {!isForceSwitch && (
            <div className="ps-execute-wrap">
              <button
                type="button"
                onClick={onExecuteTurn}
                disabled={!bothChosen}
                className="ps-execute-btn"
                style={{ background: bothChosen ? '#cc4455' : '#555' }}
              >
                {pendingLabel}
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
          className="ps-log-toggle"
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
