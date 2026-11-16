import { useId, useState, type ReactNode } from 'react';

interface CardToggleProps {
  /** The words on the toggle line (the glyph in front is the toggle's own). */
  label: ReactNode;
  children: ReactNode;
  /**
   * The body is built only while the toggle is open. A closed view then does none of the work its content does when it renders
   * (the Lines section reads the result's lines, a panel reads a search); the Explanation keeps its text in the page, hidden.
   */
  lazy?: boolean;
  /** Controlled use: the parent owns the state (a win-path search is open or not for the turn). Without `open` the toggle keeps its own, closed at first. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  /** The class of the body: the Explanation's text carries its own look. */
  bodyClassName?: string;
}

/**
 * Round 89 (the user's note on X1): the one fold of the turn card. The Explanation (round 80, T294), the Lines section and the
 * win-path question sit under a toggle line that starts closed; the card keys each by its turn, so every turn starts closed and
 * the app remembers nothing. A `button.ps-eval-analysis-toggle` with `aria-expanded` and `aria-controls`, a body with `hidden`.
 */
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
