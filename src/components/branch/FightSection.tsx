import type { BranchMoveOption, BranchSwitchOption } from '../../hooks/useBranch';
import type { BranchSlotModifiers } from '../../lib/branch-engine';
import type { DamageResult } from '../../lib/damage-calc';
import type { SpreadTargetDamage } from '../../lib/branch-damage';
import { switchOptionKey, type BranchSlotChoice } from '../../lib/branch-choices';
import type { Gimmick } from '../../hooks/useSideControlsState';
import { ComboBox } from '../ComboBox';
import { MoveBtn } from './ChoiceButtons';
import { moveChoiceFor, pickedChoice, type ChoiceContext } from './choice-context';
import type { PlayedPick } from './SideControls';
import { toId } from '../../lib/ids';

export interface WhatIfState {
  whatIfMove: string;
  setWhatIfMove: (value: string) => void;
  whatIfReplace: string | null;
  setWhatIfReplace: (value: string | null) => void;
}

export interface FightSectionProps {
  label: string;
  activeSpecies: string;
  moves: BranchMoveOption[];
  switches: BranchSwitchOption[];
  pending: BranchSlotChoice | null;
  blockedSwitchKeys: Set<string>;
  modifiers: BranchSlotModifiers;
  dmgResults: DamageResult[];
  spreadDamageResults: Record<number, SpreadTargetDamage[]>;
  targetDamageResults: Record<string, DamageResult | undefined>;
  advanced: boolean;
  played?: PlayedPick | null;
  gimmick: Gimmick;
  movePool: string[];
  whatIf: WhatIfState;
  onChoice: (choice: BranchSlotChoice) => void;
  onHypotheticalMove: (params: { species: string; move: string; replace: string | null }) => void;
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

function ModifierRow({ label, modifiers, gimmick }: { label: string; modifiers: BranchSlotModifiers; gimmick: Gimmick }) {
  const { modifier, hasZMoves, toggle } = gimmick;
  return (
    <div className="ps-modifier-row" role="group" aria-label={`Battle gimmicks for ${label}`}>
      {modifiers.teraType && (
        <ModifierToggle
          label={`Tera (${modifiers.teraType})`}
          active={modifier === 'terastallize'}
          onToggle={() => toggle('terastallize')}
        />
      )}
      {modifiers.canMegaEvo && (
        <ModifierToggle
          label="Mega Evolve"
          active={modifier === 'mega'}
          onToggle={() => toggle('mega')}
        />
      )}
      {modifiers.canUltraBurst && (
        <ModifierToggle
          label="Ultra Burst"
          active={modifier === 'ultra'}
          onToggle={() => toggle('ultra')}
        />
      )}
      {hasZMoves && (
        <ModifierToggle
          label="Z-Move"
          active={modifier === 'zmove'}
          onToggle={() => toggle('zmove')}
        />
      )}
    </div>
  );
}

function MoveGrid({ moves, advanced, dmgResults, spreadDamageResults, targetDamageResults, modifiers, pending, played, ctx, onChoice }: Pick<FightSectionProps,
  'moves' | 'advanced' | 'dmgResults' | 'spreadDamageResults' | 'targetDamageResults' | 'modifiers' | 'pending' | 'played' | 'onChoice'>
  & { ctx: ChoiceContext }) {
  const playedMoveKey = played?.kind === 'move' ? toId(played.name) : null;
  return (
    <div className={`ps-movegrid${advanced ? '' : ' ps-movegrid-compact'}`}>
      {moves.map((m, i) => (
        <MoveBtn
          key={m.slot}
          move={m}
          dmg={dmgResults[i]}
          spreadDamage={spreadDamageResults[m.slot]}
          zMoveName={ctx.modifier === 'zmove' ? modifiers.zMoves[m.slot - 1] ?? null : null}
          targetDamage={Object.fromEntries(
            m.targetOptions.map(target => [
              target.targetLoc,
              targetDamageResults[`${m.slot}:${target.targetLoc}`],
            ]),
          )}
          pendingChoice={pending}
          wasPlayed={playedMoveKey !== null && toId(m.name) === playedMoveKey}
          compact={!advanced}
          onClick={(targetLoc) => onChoice(moveChoiceFor(m, targetLoc, ctx))}
        />
      ))}
    </div>
  );
}

function ChoicePicker({ label, moves, switches, blockedSwitchKeys, onPick }: Pick<FightSectionProps,
  'label' | 'moves' | 'switches' | 'blockedSwitchKeys'> & { onPick: (value: string) => void }) {
  return (
    <select
      className="ps-input"
      aria-label={`Choice picker for ${label}`}
      value=""
      onChange={event => onPick(event.target.value)}
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
  );
}

function WhatIfRow({ label, moves, activeSpecies, movePool, whatIf, onHypotheticalMove }: Pick<FightSectionProps,
  'label' | 'moves' | 'activeSpecies' | 'movePool' | 'whatIf' | 'onHypotheticalMove'>) {
  const { whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace } = whatIf;
  return (
    <>
      <ComboBox
        options={movePool.filter(name => !moves.some(known => toId(known.name) === toId(name)))}
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
          !movePool.some(name => toId(name) === toId(whatIfMove))
        }
        onClick={() => {
          onHypotheticalMove({
            species: activeSpecies,
            move: movePool.find(name => toId(name) === toId(whatIfMove)) ?? whatIfMove.trim(),
            replace: moves.length >= 4 ? (whatIfReplace ?? moves[moves.length - 1].name) : null,
          });
          setWhatIfMove('');
        }}
      >
        Load move
      </button>
    </>
  );
}

/** The Fight face of one side: gimmick toggles, the move grid, and the Advanced power tools. */
export function FightSection(props: FightSectionProps) {
  const { label, moves, switches, blockedSwitchKeys, modifiers, advanced, gimmick, movePool, onChoice } = props;
  const ctx: ChoiceContext = { modifier: gimmick.modifier, modifierAvailable: gimmick.modifierAvailable, moves, modifiers };
  const onPickChoice = (value: string) => {
    const choice = pickedChoice(value, switches, ctx);
    if (choice) onChoice(choice);
  };
  return (
    <>
      {gimmick.hasAnyModifier && <ModifierRow label={label} modifiers={modifiers} gimmick={gimmick} />}
      <MoveGrid
        moves={moves}
        advanced={advanced}
        dmgResults={props.dmgResults}
        spreadDamageResults={props.spreadDamageResults}
        targetDamageResults={props.targetDamageResults}
        modifiers={modifiers}
        pending={props.pending}
        played={props.played}
        ctx={ctx}
        onChoice={onChoice}
      />
      {advanced && (
      <div className="ps-custom-choice">
        <ChoicePicker label={label} moves={moves} switches={switches} blockedSwitchKeys={blockedSwitchKeys} onPick={onPickChoice} />
        {/* Shares the picker's row — a second row pushed Execute Turn below the fold. */}
        {movePool.length > 0 && (
          <WhatIfRow
            label={label}
            moves={moves}
            activeSpecies={props.activeSpecies}
            movePool={movePool}
            whatIf={props.whatIf}
            onHypotheticalMove={props.onHypotheticalMove}
          />
        )}
      </div>
      )}
    </>
  );
}
