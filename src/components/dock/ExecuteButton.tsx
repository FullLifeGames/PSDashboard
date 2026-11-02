/**
 * Round 84 (turn dock): Execute, at the right of the chips. It reads "Execute Turn" when every slot that has to act holds a
 * choice, else it names what is missing; while a turn runs it reads "Executing…". With `waits` the press is queued behind the
 * engine's fill: it reads "Waits for engine…" and runs the turn once the fill landed.
 */
export function ExecuteButton({ ready, executing, waits = false, label, onClick }: {
  ready: boolean;
  executing: boolean;
  /** An Execute is queued behind the engine's fill. */
  waits?: boolean;
  label: string;
  onClick: () => void;
}) {
  const idle = ready && !executing && !waits;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!ready || executing || waits}
      aria-busy={waits && !executing ? true : undefined}
      className={`ps-execute-btn${idle ? ' ps-execute-btn-ready' : ''}`}
    >
      {executing ? 'Executing…' : waits ? 'Waits for engine…' : label}
    </button>
  );
}
