/**
 * Round 84 (turn dock): Execute, at the right of the chips. It reads "Execute Turn" when every slot that has to act holds a
 * choice, else it names what is missing; while a turn runs it reads "Executing…".
 */
export function ExecuteButton({ ready, executing, label, onClick }: {
  ready: boolean;
  executing: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!ready || executing}
      className={`ps-execute-btn${ready && !executing ? ' ps-execute-btn-ready' : ''}`}
    >
      {executing ? 'Executing…' : label}
    </button>
  );
}
