import { type EvalResult, type SideAnalysis, type RankedChoice, formatLine, winPctText } from '@fulllifegames/eval-engine';
import { rowLineTail } from '../../lib/row-line';
import { evTitle, exploreTitle, readsReply } from './turn-copy';

export function ExplorableLabel({ label, color = '#cde', onClick, opponentReads, reply }: { label: string; color?: string; onClick?: () => void; opponentReads?: boolean; reply?: string }) {
  if (!onClick) return <span style={{ color }}>{label}</span>;
  return (
    <button
      type="button"
      className="ps-btn ps-eval-inline-btn"
      title={exploreTitle(opponentReads, reply)}
      onClick={onClick}
      style={{ padding: '0 4px', fontSize: 10, color, whiteSpace: 'normal', textAlign: 'left' }}
    >
      {label} ↗
    </button>
  );
}

export function MiniBar({ value }: { value: number }) {
  const pct = 50 + 50 * Math.max(-1, Math.min(1, value));
  const positive = value >= 0;
  return (
    <span
      aria-hidden
      style={{
        position: 'relative', display: 'inline-block', width: 48, height: 7, flex: 'none',
        background: 'rgba(255,255,255,0.08)', borderRadius: 2,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${positive ? 50 : pct}%`, width: `${Math.abs(pct - 50)}%`,
          background: positive ? '#8c8' : '#f3a6a6', borderRadius: 1,
        }}
      />
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: '#667' }} />
    </span>
  );
}

/** Untracked (doubles): only the engine's preferred line, no played/blame. */
export function EngineRow({ name, side, onExplore, opponentReads, rowLines }: {
  name: string; side: SideAnalysis; onExplore?: (choice: RankedChoice) => void; opponentReads?: boolean;
  rowLines?: { result: EvalResult | null | undefined; side: 'p1' | 'p2' };
}) {
  if (!side.best) return null;
  const best = side.best;
  const tail = rowLines ? rowLineTail(rowLines.result, rowLines.side, best) : best.line;
  const reply = readsReply(opponentReads, rowLines, best)?.reply.label;
  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }} title={evTitle(name)}>
          engine: <ExplorableLabel label={best.label} onClick={onExplore && (() => onExplore(best))} opponentReads={opponentReads} reply={reply} /> ({winPctText(best.ev, side.faintedFraction)})
        </span>
        {tail && tail.length > 0 && (
          <span className="ps-eval-line">then {formatLine(tail)}</span>
        )}
      </div>
    </div>
  );
}

/** The analytic-odds suffix ("· 43% KO"); hidden when accuracy × kill roll rounds to nothing or certainty. */
export function KoSuffix({ odds }: { odds?: { accuracy: number; killFraction: number } }) {
  if (!odds) return null;
  const pct = Math.round(odds.accuracy * odds.killFraction * 100);
  if (pct <= 0 || pct >= 100) return null;
  return (
    <span
      style={{ color: '#778' }}
      title={`${Math.round(odds.accuracy * 100)}% to hit × ${Math.round(odds.killFraction * 100)}% of damage rolls KO · analytic odds vs the standing active.`}
    >
      · {pct}% KO
    </span>
  );
}
