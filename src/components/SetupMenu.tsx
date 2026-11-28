import { useEffect, useId, useRef, useState } from 'react';
import { opponentReadsEnabled } from '../lib/feature-flags';
import { SearchSelects, type SearchSelectsProps } from './SearchSelects';
import { SizeSelect } from './SizeSelect';

const OPPONENT_READS_NOTE = 'In a variation, each move you pick meets the reply that hurts it most, and Lines shows each line against that reply. '
  + 'The engine\'s suggestion, the grades and the win chances stay.';

interface SetupMenuProps {
  animateBranchTurns: boolean;
  onAnimateChange: (value: boolean) => void;
  /** The stored `hardMode` preference, shown as "Opponent reads my move". */
  opponentReads: boolean;
  onOpponentReadsChange: (value: boolean) => void;
  onEditSide: (side: 'p1' | 'p2') => void;
  onOpenSets: () => void;
  /** Left out, the menu draws none of the search rows. */
  search?: SearchSelectsProps;
}

function OpponentReadsBox({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const noteId = useId();
  return (
    <>
      <label className="ps-setup-check">
        <input type="checkbox" checked={checked} aria-describedby={noteId} onChange={event => onChange(event.target.checked)} />
        Opponent reads my move
      </label>
      <div id={noteId} className="ps-setup-note">{OPPONENT_READS_NOTE}</div>
    </>
  );
}

/** The "Opponent reads my move" box is drawn only with the flag `opponentReadsEnabled` (`src/lib/feature-flags.ts`). */
export function SetupMenu({ animateBranchTurns, onAnimateChange, opponentReads, onOpponentReadsChange, onEditSide, onOpenSets, search }: SetupMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div ref={rootRef} className="ps-setup-menu">
      <button
        type="button"
        className="ps-btn ps-setup-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
      >
        Setup <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={panelId} className="ps-setup-panel">
          <label className="ps-setup-check">
            <input type="checkbox" checked={animateBranchTurns} onChange={event => onAnimateChange(event.target.checked)} />
            Animate branch turns
          </label>
          {opponentReadsEnabled() && <OpponentReadsBox checked={opponentReads} onChange={onOpponentReadsChange} />}
          {search && <SearchSelects {...search} />}
          <SizeSelect />
          <button type="button" className="ps-btn" onClick={pick(() => onEditSide('p1'))}>Edit Player</button>
          <button type="button" className="ps-btn" onClick={pick(() => onEditSide('p2'))}>Edit Opp</button>
          <button type="button" className="ps-btn" onClick={pick(onOpenSets)}>Import/Export Sets</button>
        </div>
      )}
    </div>
  );
}
