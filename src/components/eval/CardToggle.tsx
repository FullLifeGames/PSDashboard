import { useId, useState, type ReactNode } from 'react';

interface CardToggleProps {
  label: ReactNode;
  children: ReactNode;
  /** Builds the body only while open; the Explanation keeps its text in the page, hidden. */
  lazy?: boolean;
  /** Controlled use: the parent owns the state. Without `open` the toggle keeps its own, closed at first. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  bodyClassName?: string;
}

/** The card keys each toggle by its turn, so every turn starts closed. */
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
