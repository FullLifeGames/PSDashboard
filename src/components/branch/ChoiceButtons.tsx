import type { BranchMoveOption, BranchSwitchOption } from '../../hooks/useBranch';
import type { DamageResult } from '../../lib/damage-calc';
import type { SpreadTargetDamage } from '../../lib/branch-damage';
import type { BranchSlotChoice } from '../../lib/branch-choices';
import { spriteUrl } from '../../lib/sprite-url';
import { toId } from '../../lib/ids';
import { typeBg } from '../../lib/type-colors';

function hpBarClass(pct: number) {
  if (pct > 50) return 'ps-hpbar-green';
  if (pct > 20) return 'ps-hpbar-yellow';
  return 'ps-hpbar-red';
}

const ppTextFor = (move: BranchMoveOption) => (move.maxpp > 0 ? `${move.pp}/${move.maxpp}` : '—');

function compactMoveTitle(move: BranchMoveOption, dmg: DamageResult | undefined) {
  return `${move.type || '???'} · ${ppTextFor(move)} PP` +
    (dmg && dmg.maxPercent > 0 ? ` · ${dmg.range}${dmg.koChance ? ` (${dmg.koChance})` : ''}` : '');
}

type PendingMove = Extract<BranchSlotChoice, { kind: 'move' }> | null;

const PLAYED_TITLE = 'The action played at this position on the line you are viewing.';

function MoveDamage({ dmg, spreadDamage }: { dmg?: DamageResult; spreadDamage?: SpreadTargetDamage[] }) {
  if (spreadDamage && spreadDamage.length > 1) {
    return (
      <div className="ps-movebtn-dmg">
        {spreadDamage.map(target => (
          <span key={target.label} className="ps-movebtn-spread-target">
            {target.label} {target.result.range}
          </span>
        ))}
      </div>
    );
  }
  if (!(dmg && dmg.maxPercent > 0)) return null;
  return (
    <div className="ps-movebtn-dmg">
      {dmg.range}
      {dmg.koChance && <span className="ps-movebtn-ko"> ({dmg.koChance})</span>}
    </div>
  );
}

function MoveBtnBody({ move, dmg, spreadDamage, zMoveName, wasPlayed, compact, selectedTarget }: {
  move: BranchMoveOption;
  dmg?: DamageResult;
  spreadDamage?: SpreadTargetDamage[];
  zMoveName?: string | null;
  wasPlayed?: boolean;
  compact?: boolean;
  selectedTarget: BranchMoveOption['targetOptions'][number] | null | undefined;
}) {
  const ppText = ppTextFor(move);
  return (
    <>
      <div className="ps-movebtn-name">{move.name}</div>
      {/* Advanced already names the played action in the header line. */}
      {compact && wasPlayed && <span className="ps-played-badge" title={PLAYED_TITLE}>played</span>}
      {zMoveName && (
        <div className="ps-movebtn-zmove">→ {zMoveName}</div>
      )}
      {compact ? (
        <span className="ps-movebtn-pp">{ppText}</span>
      ) : (
        <div className="ps-movebtn-info">
          <span className="ps-movebtn-type">{move.type || '???'}</span>
          <span className="ps-movebtn-pp">{ppText}</span>
        </div>
      )}
      {!compact && <MoveDamage dmg={dmg} spreadDamage={spreadDamage} />}
      {selectedTarget && (
        <div className="ps-movebtn-target">
          Targeting {selectedTarget.label} {selectedTarget.name}
        </div>
      )}
    </>
  );
}

function MoveTargetRow({ move, targetDamage, selected, pendingMove, onClick }: {
  move: BranchMoveOption;
  targetDamage: Record<number, DamageResult | undefined>;
  selected: boolean;
  pendingMove: PendingMove;
  onClick: (targetLoc?: number) => void;
}) {
  return (
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
  );
}

/* ── Move button ── */
export function MoveBtn({ move, dmg, spreadDamage, zMoveName, targetDamage, pendingChoice, wasPlayed, compact, onClick }: {
  move: BranchMoveOption;
  dmg?: DamageResult;
  spreadDamage?: SpreadTargetDamage[];
  zMoveName?: string | null;
  targetDamage: Record<number, DamageResult | undefined>;
  pendingChoice: BranchSlotChoice | null;
  /** This is the move the viewed line actually played at this position. */
  wasPlayed?: boolean;
  /** Basic view: a small chip (name + PP; type and damage in the tooltip). */
  compact?: boolean;
  onClick: (targetLoc?: number) => void;
}) {
  const bg = typeBg(move.type);
  const pendingMove = pendingChoice?.kind === 'move' ? pendingChoice : null;
  const selected = pendingMove?.moveId === toId(move.name);
  const selectedTarget = selected
    ? move.targetOptions.find(target => target.targetLoc === pendingMove?.targetLoc)
    : null;
  return (
    <div>
      <button
        type="button"
        onClick={() => onClick(move.targetOptions[0]?.targetLoc)}
        disabled={move.disabled || (move.requiresTarget && move.targetOptions.length === 0)}
        className={`ps-movebtn ${compact ? 'ps-movebtn-compact ' : ''}${selected ? 'ps-movebtn-selected' : ''}`}
        style={{ background: bg }}
        title={compact ? compactMoveTitle(move, dmg) : undefined}
      >
        <MoveBtnBody
          move={move}
          dmg={dmg}
          spreadDamage={spreadDamage}
          zMoveName={zMoveName}
          wasPlayed={wasPlayed}
          compact={compact}
          selectedTarget={selectedTarget}
        />
      </button>
      {move.targetOptions.length > 0 && (
        <MoveTargetRow move={move} targetDamage={targetDamage} selected={selected} pendingMove={pendingMove} onClick={onClick} />
      )}
    </div>
  );
}

/* ── Switch button ── */
export function SwitchBtn({ sw, selected, disabled, disabledReason, wasPlayed, compact, onClick }: {
  sw: BranchSwitchOption; selected: boolean; disabled: boolean; disabledReason?: string; wasPlayed?: boolean;
  /** Basic view: a small chip (sprite + name + HP%). */
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sw.fainted || disabled}
      title={disabled ? disabledReason : compact ? `${sw.name} · ${sw.hp}` : undefined}
      aria-disabled={disabled || sw.fainted}
      className={`ps-switchbtn ${compact ? 'ps-switchbtn-compact ' : ''}${selected ? 'ps-switchbtn-selected' : ''}`}
    >
      <img src={spriteUrl(sw.species)} alt={sw.name} />
      {compact ? (
        <div className="ps-switchbtn-name">
          {sw.name}
          {wasPlayed && <span className="ps-played-badge" title={PLAYED_TITLE}>played</span>}
          <span className="ps-switchbtn-hp"> {sw.hpPercent}%</span>
        </div>
      ) : (
        <>
          <div>
            <div className="ps-switchbtn-name">
              {sw.name}
            </div>
            <div style={{ width: 60 }}>
              <div className="ps-hpbar-track" style={{ height: 4, marginTop: 2 }}>
                <div className={`ps-hpbar-fill ${hpBarClass(sw.hpPercent)}`} style={{ width: `${sw.hpPercent}%` }} />
              </div>
            </div>
          </div>
          <span className="ps-switchbtn-hp">{sw.hp}</span>
        </>
      )}
    </button>
  );
}
