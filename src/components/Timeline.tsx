interface Props {
  currentTurn: number;
  maxTurn: number;
  onTurnChange: (turn: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function Timeline({ currentTurn, maxTurn, onTurnChange, onPrev, onNext }: Props) {
  return (
    <div className="bg-[#16213e] rounded-xl p-4 mb-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onPrev}
          disabled={currentTurn <= 1}
          className="px-3 py-1.5 bg-[#0f3460] hover:bg-[#1a1a5e] disabled:opacity-30 rounded-lg transition-colors text-lg"
        >
          {'<'}
        </button>

        <div className="flex-1 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={maxTurn}
            value={currentTurn}
            onChange={e => onTurnChange(parseInt(e.target.value, 10))}
            className="flex-1 accent-[#e94560]"
          />
        </div>

        <button
          onClick={onNext}
          disabled={currentTurn >= maxTurn}
          className="px-3 py-1.5 bg-[#0f3460] hover:bg-[#1a1a5e] disabled:opacity-30 rounded-lg transition-colors text-lg"
        >
          {'>'}
        </button>

        <span className="text-sm text-gray-400 min-w-[80px] text-center">
          Turn <span className="text-white font-bold">{currentTurn}</span> / {maxTurn}
        </span>
      </div>
    </div>
  );
}
