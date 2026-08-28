import { useEffect, useState, useMemo } from 'react';
import type { BranchSimState, BranchMoveOption, BranchSwitchOption } from '../hooks/useBranch';
import type { BranchSlotModifiers } from '../lib/branch-engine';
import type { BranchMoveModifier } from '../lib/branch-choices';
import type { DamageResult } from '../lib/damage-calc';
import {
  branchSideChoicesReady,
  choiceId,
  describeSlotChoice,
  requiredChoicesForActiveSlots,
  switchChoiceKey,
  switchOptionKey,
  type BranchSlotChoice,
} from '../lib/branch-choices';
import { pickRecommendedMove } from '../lib/recommendation';
import type { PickerSource } from '../lib/picker-state';
import { spriteUrl } from '../lib/sprite-url';
import { ComboBox } from './ComboBox';

interface Props {
  simState: BranchSimState | null;
  /**
   * Where this position's choices come from (unified timeline, variant B):
   * 'live' = the branch sim stands here; 'stored' = rebuilt from a recorded
   * position; 'snapshot' = approximated from replay snapshot + guessed teams
   * (the sim validates legality when the move executes). Undefined renders
   * like 'live' (legacy callers).
   */
  source?: PickerSource;
  /** Rebuilds the live sim at this position WITHOUT executing a move —
   *  offered on snapshot approximations, where doubles targeting and exact
   *  PP need the real request. */
  onMaterialize?: () => void;
  executeError: string | null;
  /** True while a turn is being written to the sim — blocks double executes. */
  executing: boolean;
  /** Generation of the loaded replay — keeps the damage calc on the sim's gen (B5). */
  gen: number;
  onSetChoice: (side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => void;
  /** "What if it had …": loads a legal move into the active set and rebuilds the branch. */
  onHypotheticalMove: (side: 'p1' | 'p2', activeSlot: number, params: { species: string; move: string; replace: string | null }) => void;
  onExecuteTurn: () => void;
}

interface SpreadTargetDamage {
  label: string;
  result: DamageResult;
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
const EMPTY_MODIFIERS: BranchSlotModifiers = {
  teraType: null,
  canMegaEvo: false,
  canUltraBurst: false,
  zMoves: [],
};

function typeBg(type: string) { return TYPE_BG[type] || '#68A090'; }


function hpBarClass(pct: number) {
  if (pct > 50) return 'ps-hpbar-green';
  if (pct > 20) return 'ps-hpbar-yellow';
  return 'ps-hpbar-red';
}

/* ── Move button ── */
function MoveBtn({ move, dmg, spreadDamage, zMoveName, targetDamage, pendingChoice, onClick }: {
  move: BranchMoveOption;
  dmg?: DamageResult;
  spreadDamage?: SpreadTargetDamage[];
  zMoveName?: string | null;
  targetDamage: Record<number, DamageResult | undefined>;
  pendingChoice: BranchSlotChoice | null;
  onClick: (targetLoc?: number) => void;
}) {
  const bg = typeBg(move.type);
  const pendingMove = pendingChoice?.kind === 'move' ? pendingChoice : null;
  const selected = pendingMove?.moveId === choiceId(move.name);
  const selectedTarget = selected
    ? move.targetOptions.find(target => target.targetLoc === pendingMove?.targetLoc)
    : null;
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
        {zMoveName && (
          <div className="ps-movebtn-zmove">→ {zMoveName}</div>
        )}
        <div className="ps-movebtn-info">
          <span className="ps-movebtn-type">{move.type || '???'}</span>
          <span className="ps-movebtn-pp">{move.maxpp > 0 ? `${move.pp}/${move.maxpp}` : '—'}</span>
        </div>
        {spreadDamage && spreadDamage.length > 1 ? (
          <div className="ps-movebtn-dmg">
            {spreadDamage.map(target => (
              <span key={target.label} className="ps-movebtn-spread-target">
                {target.label} {target.result.range}
              </span>
            ))}
          </div>
        ) : dmg && dmg.maxPercent > 0 && (
          <div className="ps-movebtn-dmg">
            {dmg.range}
            {dmg.koChance && <span className="ps-movebtn-ko"> ({dmg.koChance})</span>}
          </div>
        )}
        {selectedTarget && (
          <div className="ps-movebtn-target">
            Targeting {selectedTarget.label} {selectedTarget.name}
          </div>
        )}
      </button>
      {move.targetOptions.length > 0 && (
        <div className="ps-target-row">
          {move.targetOptions.map(target => {
            const damage = targetDamage[target.targetLoc];
            const targetSelected = !!selected && pendingMove?.targetLoc === target.targetLoc;
            return (
              <button
                key={target.targetLoc}
                type="button"
                onClick={() => onClick(target.targetLoc)}
                disabled={move.disabled}
                className={`ps-target-btn ${targetSelected ? 'ps-target-btn-selected' : ''}`}
                title={`${move.name} into ${target.name} (${target.hpPercent}%)`}
                aria-pressed={targetSelected}
              >
                <span className="ps-target-main">
                  <span className="ps-target-slot">{target.label}</span>
                  {' '}
                  <span className="ps-target-name">{target.name}</span>
                </span>
                <span className="ps-target-meta">
                  {target.hpPercent}% HP
                  {damage?.maxPercent ? ` · ${damage.range}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Switch button ── */
function SwitchBtn({ sw, selected, disabled, disabledReason, onClick }: {
  sw: BranchSwitchOption; selected: boolean; disabled: boolean; disabledReason?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sw.fainted || disabled}
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled || sw.fainted}
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
function SideControls({ side, label, activeName, activeSpecies, activeFainted, moves, switches, forceSwitch, pending, blockedSwitchKeys, modifiers, dmgResults, spreadDamageResults, targetDamageResults, gen, onChoice, onHypotheticalMove }: {
  side: 'p1' | 'p2';
  label: string;
  activeName: string;
  activeSpecies: string;
  activeFainted: boolean;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  forceSwitch: boolean;
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  modifiers: BranchSlotModifiers;
  dmgResults: DamageResult[];
  spreadDamageResults: Record<number, SpreadTargetDamage[]>;
  targetDamageResults: Record<string, DamageResult | undefined>;
  gen: number;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
}) {
  const [tab, setTab] = useState<'fight' | 'switch'>(forceSwitch ? 'switch' : 'fight');
  const [modifier, setModifier] = useState<BranchMoveModifier | null>(null);
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  const [movePool, setMovePool] = useState<string[]>([]);

  // Legal move pool for "What if it had …" — loaded lazily per active species.
  useEffect(() => {
    let alive = true;
    setMovePool([]);
    if (!activeSpecies) return;
    void import('../lib/pokemon-options')
      .then(options => options.getMovePool(activeSpecies, gen))
      .then(pool => {
        if (alive) setMovePool(pool);
      });
    return () => {
      alive = false;
    };
  }, [activeSpecies, gen]);
  const hasZMoves = modifiers.zMoves.some(Boolean);
  const hasAnyModifier = !!modifiers.teraType || modifiers.canMegaEvo || modifiers.canUltraBurst || hasZMoves;
  const modifierAvailable =
    (modifier === 'terastallize' && !!modifiers.teraType) ||
    (modifier === 'mega' && modifiers.canMegaEvo) ||
    (modifier === 'ultra' && modifiers.canUltraBurst) ||
    (modifier === 'zmove' && hasZMoves);

  // The toggle is local component state — once the gimmick is spent (or the
  // active Pokémon changed and can't use it), it must not silently stick to
  // future move choices ("Thundurus can't Terastallize" after an earlier Tera).
  useEffect(() => {
    if (modifier && !modifierAvailable) setModifier(null);
  }, [modifier, modifierAvailable]);
  const recommendation = useMemo(
    () => pickRecommendedMove(side, moves, dmgResults, targetDamageResults),
    [side, moves, dmgResults, targetDamageResults],
  );

  return (
    <div className="ps-controls ps-side-controls">
      <div className="ps-whatdo">
        <span className="ps-side-label">{label}</span>
        {' '}
        {forceSwitch ? (
          <>Choose a replacement{activeFainted ? <> for <strong>{activeName}</strong></> : null}</>
        ) : (
          <>What will <strong>{activeName}</strong> do?</>
        )}
        {pending && (
          <span className="ps-pending-choice">
            [{describeSlotChoice(pending)}]
          </span>
        )}
      </div>

      {forceSwitch && (
        <div className="ps-force-switch-note">
          {activeFainted
            ? `${activeName} fainted! Choose who to send in:`
            : `${activeName} is switching out — choose who to send in:`}
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
          {hasAnyModifier && (
            <div className="ps-modifier-row" role="group" aria-label={`Battle gimmicks for ${label}`}>
              {modifiers.teraType && (
                <ModifierToggle
                  label={`Tera (${modifiers.teraType})`}
                  active={modifier === 'terastallize'}
                  onToggle={() => setModifier(current => current === 'terastallize' ? null : 'terastallize')}
                />
              )}
              {modifiers.canMegaEvo && (
                <ModifierToggle
                  label="Mega Evolve"
                  active={modifier === 'mega'}
                  onToggle={() => setModifier(current => current === 'mega' ? null : 'mega')}
                />
              )}
              {modifiers.canUltraBurst && (
                <ModifierToggle
                  label="Ultra Burst"
                  active={modifier === 'ultra'}
                  onToggle={() => setModifier(current => current === 'ultra' ? null : 'ultra')}
                />
              )}
              {hasZMoves && (
                <ModifierToggle
                  label="Z-Move"
                  active={modifier === 'zmove'}
                  onToggle={() => setModifier(current => current === 'zmove' ? null : 'zmove')}
                />
              )}
            </div>
          )}
          {recommendation && (
            <button
              type="button"
              className="ps-recommendation-btn"
              onClick={() => onChoice(moveChoiceFor(recommendation.move, recommendation.targetLoc))}
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
                spreadDamage={spreadDamageResults[m.slot]}
                zMoveName={modifier === 'zmove' ? modifiers.zMoves[m.slot - 1] ?? null : null}
                targetDamage={Object.fromEntries(
                  m.targetOptions.map(target => [
                    target.targetLoc,
                    targetDamageResults[`${m.slot}:${target.targetLoc}`],
                  ]),
                )}
                pendingChoice={pending}
                onClick={(targetLoc) => onChoice(moveChoiceFor(m, targetLoc))}
              />
            ))}
          </div>
          <div className="ps-custom-choice">
            <select
              className="ps-input"
              aria-label={`Choice picker for ${label}`}
              value=""
              onChange={event => onPickChoice(event.target.value)}
            >
              <option value="" disabled>All choices…</option>
              <optgroup label="Moves">
                {moves.filter(move => !move.disabled).flatMap(move => (
                  move.targetOptions.length > 0
                    ? move.targetOptions.map(target => (
                      <option key={`m-${move.slot}-${target.targetLoc}`} value={`move:${move.slot}:${target.targetLoc}`}>
                        {move.name} → {target.label} {target.name}
                      </option>
                    ))
                    : [
                      <option key={`m-${move.slot}`} value={`move:${move.slot}`}>
                        {move.name}
                      </option>,
                    ]
                ))}
              </optgroup>
              {switches.length > 0 && (
                <optgroup label="Switch to">
                  {switches.map(sw => (
                    <option
                      key={`s-${sw.slot}`}
                      value={`switch:${sw.slot}`}
                      disabled={blockedSwitchKeys.has(switchOptionKey(sw))}
                    >
                      Switch: {sw.name} ({sw.hpPercent}% HP)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* Shares the picker's row — a second row pushed Execute Turn below the fold. */}
            {movePool.length > 0 && (
              <>
                <ComboBox
                  options={movePool.filter(name => !moves.some(known => choiceId(known.name) === choiceId(name)))}
                  value={whatIfMove}
                  onChange={setWhatIfMove}
                  onSelect={setWhatIfMove}
                  placeholder="What if it had…"
                  ariaLabel={`Hypothetical move for ${label}`}
                />
                {moves.length >= 4 && (
                  <select
                    className="ps-input"
                    aria-label={`Replaced move for ${label}`}
                    value={whatIfReplace ?? moves[moves.length - 1].name}
                    onChange={event => setWhatIfReplace(event.target.value)}
                    style={{ flex: '0 1 110px' }}
                  >
                    {moves.map(known => <option key={known.slot} value={known.name}>{known.name}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  className="ps-btn"
                  disabled={
                    !whatIfMove.trim() ||
                    !movePool.some(name => choiceId(name) === choiceId(whatIfMove))
                  }
                  onClick={() => {
                    onHypotheticalMove({
                      species: activeSpecies,
                      move: movePool.find(name => choiceId(name) === choiceId(whatIfMove)) ?? whatIfMove.trim(),
                      replace: moves.length >= 4 ? (whatIfReplace ?? moves[moves.length - 1].name) : null,
                    });
                    setWhatIfMove('');
                  }}
                >
                  Load move
                </button>
              </>
            )}
          </div>
        </>
      )}

      {(forceSwitch || tab === 'switch') && switches.length > 0 && (
        <div className="ps-switchgrid">
          {switches.map(sw => {
            const selected = switchChoiceKey(pending) === switchOptionKey(sw);
            return (
              <SwitchBtn
                key={sw.slot}
                sw={sw}
                selected={selected}
                disabled={blockedSwitchKeys.has(switchOptionKey(sw)) && !selected}
                disabledReason={`${sw.name} is already chosen as the switch-in for your other slot.`}
                onClick={() => onChoice({ kind: 'switch', speciesId: choiceId(sw.species), pokemonName: sw.name })}
              />
            );
          })}
        </div>
      )}
    </div>
  );

  function withModifier(choice: BranchSlotChoice): BranchSlotChoice {
    if (choice.kind !== 'move' || !modifier || !modifierAvailable) return choice;
    // A Z toggle only applies to moves that actually have a Z option.
    if (modifier === 'zmove') {
      const moveIndex = moves.findIndex(candidate => choiceId(candidate.name) === choice.moveId);
      if (moveIndex < 0 || !modifiers.zMoves[moveIndex]) return choice;
    }
    return { ...choice, modifier };
  }

  function moveChoiceFor(move: BranchMoveOption, targetLoc?: number): BranchSlotChoice {
    return withModifier({
      kind: 'move',
      moveId: choiceId(move.name),
      moveName: move.name,
      ...(targetLoc !== undefined ? { targetLoc } : {}),
    });
  }

  function onPickChoice(value: string) {
    const [kind, slotText, targetText] = value.split(':');
    const slot = parseInt(slotText, 10);
    if (kind === 'move') {
      const move = moves.find(candidate => candidate.slot === slot);
      if (!move) return;
      const targetLoc = targetText !== undefined ? parseInt(targetText, 10) : undefined;
      onChoice(moveChoiceFor(move, targetLoc));
      return;
    }
    if (kind === 'switch') {
      const target = switches.find(candidate => candidate.slot === slot);
      if (!target) return;
      onChoice({ kind: 'switch', speciesId: choiceId(target.species), pokemonName: target.name });
    }
  }
}

function ModifierToggle({ label, active, onToggle }: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`ps-modifier-toggle ${active ? 'ps-modifier-toggle-active' : ''}`}
      aria-pressed={active}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

interface SideDamage {
  default: DamageResult[][];
  targets: Record<number, Record<string, DamageResult | undefined>>;
  spread: Record<number, Record<number, SpreadTargetDamage[]>>;
}

const EMPTY_SIDE_DAMAGE: SideDamage = { default: [], targets: {}, spread: {} };

/* ── Main BranchPanel (controls only, no iframe) ── */
export function BranchPanel({ simState, source, onMaterialize, executeError, executing, gen, onSetChoice, onHypotheticalMove, onExecuteTurn }: Props) {
  const [showLog, setShowLog] = useState(false);
  const [damageBySide, setDamageBySide] = useState<{ p1: SideDamage; p2: SideDamage }>({
    p1: EMPTY_SIDE_DAMAGE,
    p2: EMPTY_SIDE_DAMAGE,
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
  const fieldState = simState?.field ?? null;

  useEffect(() => {
    let cancelled = false;

    async function calculatePreviewDamage() {
      const { calcSingleDamageRange } = await import('../lib/damage-calc');
      if (cancelled) return;

      const gameType = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1 ? 'Doubles' as const : 'Singles' as const;
      const contextFor = (attacker: 'p1' | 'p2') => ({
        gameType,
        gen,
        weather: fieldState?.weather,
        terrain: fieldState?.terrain,
        attackerSideConditions: attacker === 'p1' ? fieldState?.p1SideConditions : fieldState?.p2SideConditions,
        defenderSideConditions: attacker === 'p1' ? fieldState?.p2SideConditions : fieldState?.p1SideConditions,
      });
      const targetBySideSlot = {
        p1: new Map(p1ActiveSlots.map((active, index) => [`p1:${index}`, active])),
        p2: new Map(p2ActiveSlots.map((active, index) => [`p2:${index}`, active])),
      };

      const makeSideDamage = (side: 'p1' | 'p2'): SideDamage => {
        const activeSlots = side === 'p1' ? p1ActiveSlots : p2ActiveSlots;
        const movesBySlot = side === 'p1' ? p1MovesBySlot : p2MovesBySlot;
        const enemySide = side === 'p1' ? 'p2' : 'p1';
        const enemyActives = (side === 'p1' ? p2ActiveSlots : p1ActiveSlots)
          .map((active, index) => ({ active, index }))
          .filter((entry): entry is { active: NonNullable<typeof entry.active>; index: number } =>
            !!entry.active && !entry.active.fainted && entry.active.hp > 0);
        const context = contextFor(side);

        const defaults: DamageResult[][] = [];
        const spread: SideDamage['spread'] = {};
        const targets: SideDamage['targets'] = {};

        activeSlots.forEach((active, activeSlot) => {
          const moves = movesBySlot[activeSlot] ?? EMPTY_MOVES;
          defaults[activeSlot] = [];
          spread[activeSlot] = {};
          targets[activeSlot] = {};
          if (!active || moves.length === 0) return;

          const targetEntries: [string, DamageResult][] = [];
          moves.forEach((move, moveIndex) => {
            for (const target of move.targetOptions) {
              const defender = targetBySideSlot[target.side].get(`${target.side}:${target.activeSlot}`);
              if (defender) {
                targetEntries.push([`${move.slot}:${target.targetLoc}`, calcSingleDamageRange(active, defender, move, context)]);
              }
            }

            if (enemyActives.length === 0) return;
            // Untargeted moves (spread/self/singles): one range per living enemy (G6).
            const perTarget = enemyActives.map(enemy => ({
              label: `${enemySide.toUpperCase()}${String.fromCharCode(65 + enemy.index)}`,
              result: calcSingleDamageRange(active, enemy.active, move, context),
            }));
            const best = perTarget.reduce((currentBest, candidate) =>
              candidate.result.maxPercent > currentBest.result.maxPercent ? candidate : currentBest,
            perTarget[0]);
            defaults[activeSlot][moveIndex] = best.result;
            if (move.targetOptions.length === 0 && perTarget.length > 1 &&
              perTarget.some(target => target.result.maxPercent > 0)) {
              spread[activeSlot][move.slot] = perTarget;
            }
          });
          targets[activeSlot] = Object.fromEntries(targetEntries);
        });

        return { default: defaults, targets, spread };
      };

      if (!cancelled) {
        setDamageBySide({
          p1: makeSideDamage('p1'),
          p2: makeSideDamage('p2'),
        });
      }
    }

    void calculatePreviewDamage();
    return () => {
      cancelled = true;
    };
  }, [p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen]);

  if (!simState) return null;

  const isForceSwitch = simState.p1ForceSwitch || simState.p2ForceSwitch;
  const isMultiActive = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1;
  const p1RequiredChoices = requiredChoicesForActiveSlots(p1ActiveSlots, simState.p1ForceSwitches);
  const p2RequiredChoices = requiredChoicesForActiveSlots(p2ActiveSlots, simState.p2ForceSwitches);
  const bothChosen = branchSideChoicesReady(simState.p1Choices, p1RequiredChoices) &&
    branchSideChoicesReady(simState.p2Choices, p2RequiredChoices);
  const blockedSwitchKeys = (choices: (BranchSlotChoice | null)[], activeSlot: number) => {
    const blocked = new Set<string>();
    choices.forEach((choice, index) => {
      if (index === activeSlot) return;
      const target = switchChoiceKey(choice);
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
      {source && source !== 'live' && (
        <div style={{ fontSize: 10, color: '#9fb2cc', margin: '6px 0 2px', display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span>
            Choices {source === 'stored'
              ? 'from the recorded position'
              : 'from snapshot — the sim validates on execute'}
          </span>
          {source === 'snapshot' && onMaterialize && (
            <button
              type="button"
              onClick={onMaterialize}
              disabled={executing}
              className="ps-btn"
              style={{ padding: '0 6px', fontSize: 10 }}
              title="Reconstructs the simulator at this position without playing a move — exact PP, disables, and (in doubles) targets."
            >
              Load exact choices
            </button>
          )}
        </div>
      )}
      {/* Controls — stacked vertically for P1 + P2 selection */}
      {!simState.ended && (
        <div className="ps-branch-controls-shell">
          <div className="ps-branch-controls-grid">
            <div className="ps-branch-side-column">
              {p1ActiveSlots.map((active, slot) => (
                <SideControls
                  key={`p1-${slot}`}
                  side="p1"
                  label={p1ActiveSlots.length > 1 ? `P1${String.fromCharCode(65 + slot)}` : 'P1'}
                  activeName={active?.name || '???'}
                  activeSpecies={active?.species || ''}
                  activeFainted={active?.fainted ?? true}
                  moves={p1MovesBySlot[slot] ?? EMPTY_MOVES}
                  switches={p1SwitchesBySlot[slot] ?? EMPTY_SWITCHES}
                  forceSwitch={simState.p1ForceSwitches[slot] ?? false}
                  pending={simState.p1Choices[slot] ?? null}
                  blockedSwitchKeys={blockedSwitchKeys(simState.p1Choices, slot)}
                  modifiers={simState.p1ModifiersBySlot[slot] ?? EMPTY_MODIFIERS}
                  dmgResults={damageBySide.p1.default[slot] ?? []}
                  spreadDamageResults={damageBySide.p1.spread[slot] ?? {}}
                  targetDamageResults={damageBySide.p1.targets[slot] ?? {}}
                  gen={gen}
                  onChoice={(choice) => onSetChoice('p1', choice, slot)}
                  onHypotheticalMove={(params) => onHypotheticalMove('p1', slot, params)}
                />
              ))}
            </div>
            <div className="ps-side-divider" />
            <div className="ps-branch-side-column">
              {p2ActiveSlots.map((active, slot) => (
                <SideControls
                  key={`p2-${slot}`}
                  side="p2"
                  label={p2ActiveSlots.length > 1 ? `P2${String.fromCharCode(65 + slot)}` : 'P2'}
                  activeName={active?.name || '???'}
                  activeSpecies={active?.species || ''}
                  activeFainted={active?.fainted ?? true}
                  moves={p2MovesBySlot[slot] ?? EMPTY_MOVES}
                  switches={p2SwitchesBySlot[slot] ?? EMPTY_SWITCHES}
                  forceSwitch={simState.p2ForceSwitches[slot] ?? false}
                  pending={simState.p2Choices[slot] ?? null}
                  blockedSwitchKeys={blockedSwitchKeys(simState.p2Choices, slot)}
                  modifiers={simState.p2ModifiersBySlot[slot] ?? EMPTY_MODIFIERS}
                  dmgResults={damageBySide.p2.default[slot] ?? []}
                  spreadDamageResults={damageBySide.p2.spread[slot] ?? {}}
                  targetDamageResults={damageBySide.p2.targets[slot] ?? {}}
                  gen={gen}
                  onChoice={(choice) => onSetChoice('p2', choice, slot)}
                  onHypotheticalMove={(params) => onHypotheticalMove('p2', slot, params)}
                />
              ))}
            </div>
          </div>

          {executeError && (
            <div className="ps-choice-error ps-execute-error" role="alert">
              {executeError}
            </div>
          )}

          {/* Execute turn button */}
          {!isForceSwitch && (
            <div className="ps-execute-wrap">
              <button
                type="button"
                onClick={onExecuteTurn}
                disabled={!bothChosen || executing}
                className="ps-execute-btn"
                style={{ background: bothChosen && !executing ? '#cc4455' : '#555' }}
              >
                {executing ? 'Executing…' : pendingLabel}
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
