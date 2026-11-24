import { useId, useState, type ReactNode } from 'react';

interface CardToggleProps {
  label: ReactNode;
  children: ReactNode;
  /**
   * The body is built only while the toggle is open, so a closed view skips the work its content does on render (the Lines section
   * reads the result's lines, a panel reads a search); the Explanation keeps its text in the page, hidden.
   */
  lazy?: boolean;
  /** Controlled use: the parent owns the state. Without `open` the toggle keeps its own, closed at first. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  bodyClassName?: string;
}

/** The one fold of the turn card, closed at first; the card keys each by its turn, so every turn starts closed. */
export function CardToggle({ label, children, lazy = false, open: controlled, onToggle, disabled, title, bodyClassName }: CardToggleProps) {
  const [kept, setKept] = useState(false);
  const id = useId();
  const open = controlled ?? kept;
  const flip = () => {
    if (onToggle) onToggle(!open);
    else setKept(!open);
  };
  return (
    <>
      <button type="button" className="ps-eval-analysis-toggle" aria-expanded={open} aria-controls={id} disabled={disabled} title={title} onClick={flip}>
        <span aria-hidden="true">{open ? '▾' : '▸'} </span>{label}
      </button>
      <div id={id} className={bodyClassName} hidden={!open}>{lazy && !open ? null : children}</div>
    </>
  );
}
