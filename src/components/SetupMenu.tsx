import { useEffect, useId, useRef, useState } from 'react';
import { gameReviewEnabled, opponentReadsEnabled } from '../lib/feature-flags';
import { SizeSelect } from './SizeSelect';

/** Round 89 (#153, HM-2): what the setting changes and where; the grades stay as they are. */
const opponentReadsTitle = (): string => 'In a variation the opponent answers each move you pick with the reply the search rates lowest for it, as if it had read your move: '
  + `when you click an engine move, in the turn dock, and in a turn's lines${gameReviewEnabled() ? ' and the Game review' : ''}. `
  + 'Off, it plays its own top choice, which does not depend on your move. Grades and scores stay as they are. A change applies from your next pick.';

interface SetupMenuProps {
  animateBranchTurns: boolean;
  onAnimateChange: (value: boolean) => void;
  /** Round 89 (#153, HM-2): the stored `hardMode` preference, shown as "Opponent reads my move". */
  opponentReads: boolean;
  onOpponentReadsChange: (value: boolean) => void;
  onEditSide: (side: 'p1' | 'p2') => void;
  onOpenSets: () => void;
}

/**
 * Round 77 (user request 28.10.2026): the top bar keeps one row. The animate toggle and the three team
 * actions open from one button; a pick closes the menu, the toggle keeps it open, and so do Escape and
 * a click outside it. Round 84 (T315): the Size select of the app's scale stands under the animate toggle and keeps the menu
 * open like it. Round 89 (#153, HM-2): the box that stood in the Evaluation row as "Hard mode" sits here as "Opponent reads my move", below
 * the animate toggle, and keeps the menu open too. Round 89 (ruling 49): behind the flag `opponentReadsEnabled` (src/lib/feature-flags.ts); off, the box is not drawn.
 */
export function SetupMenu({ animateBranchTurns, onAnimateChange, opponentReads, onOpponentReadsChange, onEditSide, onOpenSets }: SetupMenuProps) {
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
          {opponentReadsEnabled() && (
            <label className="ps-setup-check" title={opponentReadsTitle()}>
              <input type="checkbox" checked={opponentReads} onChange={event => onOpponentReadsChange(event.target.checked)} />
              Opponent reads my move
            </label>
          )}
          <SizeSelect />
          <button type="button" className="ps-btn" onClick={pick(() => onEditSide('p1'))}>Edit Player</button>
          <button type="button" className="ps-btn" onClick={pick(() => onEditSide('p2'))}>Edit Opp</button>
          <button type="button" className="ps-btn" onClick={pick(onOpenSets)}>Import/Export Sets</button>
        </div>
      )}
    </div>
  );
}
