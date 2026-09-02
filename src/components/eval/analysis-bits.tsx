import type { SideAnalysis } from '../../lib/eval/analysis';
import type { RankedChoice } from '../../lib/eval/types';
import { winPctText } from '../../lib/eval/winprob';
import { evTitle } from './turn-copy';

/** The engine's line as a click-to-explore button, or a plain span. */
export function ExplorableLabel({ label, color = '#cde', onClick }: { label: string; color?: string; onClick?: () => void }) {
  if (!onClick) return <span style={{ color }}>{label}</span>;
  return (
    <button
      type="button"
      className="ps-btn ps-eval-inline-btn"
      title="Play this line out in a branch"
      onClick={onClick}
      style={{ padding: '0 4px', fontSize: 10, color, whiteSpace: 'normal', textAlign: 'left' }}
    >
      {label} ↗
    </button>
  );
}

/** Tiny centered gauge on [−1, +1] — makes score gaps visual at a glance. */
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

/** Untracked (doubles): only the engine's preferred line — no played/blame. */
export function EngineRow({ name, side, onExplore }: { name: string; side: SideAnalysis; onExplore?: (choice: RankedChoice) => void }) {
  if (!side.best) return null;
  const best = side.best;
  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }} title={evTitle(name)}>
          engine: <ExplorableLabel label={best.label} onClick={onExplore && (() => onExplore(best))} /> ({winPctText(best.ev)})
        </span>
        {best.line && best.line.length > 0 && (
          <span className="ps-eval-line">then {best.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Compact analytic-odds suffix for a ranked row (round 6): "· 43% KO" with
 * the accuracy × kill-roll decomposition in the tooltip. Hidden when the
 * product rounds to nothing or to certainty.
 */
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
