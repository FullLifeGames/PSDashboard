/** With `waits` a press is queued behind the engine's fill and runs the turn once it landed. */
export function ExecuteButton({ ready, executing, waits = false, label, onClick }: {
  ready: boolean;
  executing: boolean;
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
