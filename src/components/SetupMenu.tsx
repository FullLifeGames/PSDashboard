import { useEffect, useId, useRef, useState } from 'react';

interface SetupMenuProps {
  animateBranchTurns: boolean;
  onAnimateChange: (value: boolean) => void;
  onEditSide: (side: 'p1' | 'p2') => void;
  onOpenSets: () => void;
}

/**
 * Round 77 (user request 28.10.2026): the top bar keeps one row. The animate toggle and the three team
 * actions open from one button; a pick closes the menu, the toggle keeps it open, and so do Escape and
 * a click outside it.
 */
export function SetupMenu({ animateBranchTurns, onAnimateChange, onEditSide, onOpenSets }: SetupMenuProps) {
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
          <button type="button" className="ps-btn" onClick={pick(() => onEditSide('p1'))}>Edit Player</button>
          <button type="button" className="ps-btn" onClick={pick(() => onEditSide('p2'))}>Edit Opp</button>
          <button type="button" className="ps-btn" onClick={pick(onOpenSets)}>Import/Export Sets</button>
        </div>
      )}
    </div>
  );
}
