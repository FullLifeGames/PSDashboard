import { computeBlunders } from '../lib/eval/graph';
import { winPercent } from '../lib/eval/winprob';

interface EvalGraphProps {
  /** scores[t-1] = score at turn t (p1 perspective, [-1,1]); null = gap. */
  scores: (number | null)[];
  playerNames: [string, string];
  currentTurn: number;
  onSelectTurn?: (turn: number) => void;
  /** Turn 0 (team preview) game value — adds a leads point before turn 1. */
  leadScore?: number | null;
}

const WIDTH = 300;
const HEIGHT = 64;
const PAD_X = 4;

/**
 * Chess-style evaluation line over the whole game. Single series (no legend
 * needed); point color carries the polarity via the app's player colors;
 * blunder markers add a shape ring plus tooltip text, never color alone.
 */
export function EvalGraph({ scores, playerNames, currentTurn, onSelectTurn, leadScore }: EvalGraphProps) {
  const turns = scores.length;
  if (turns === 0) return null;

  // With a lead evaluation the x-domain starts at turn 0 (team preview).
  const hasLead = leadScore !== null && leadScore !== undefined;
  const first = hasLead ? 0 : 1;
  const x = (turn: number) => turns === first
    ? WIDTH / 2
    : PAD_X + ((turn - first) / (turns - first)) * (WIDTH - 2 * PAD_X);
  const y = (score: number) => HEIGHT / 2 - score * (HEIGHT / 2 - 6);

  // Consecutive non-null runs become path segments; gaps stay gaps.
  const segments: string[] = [];
  let current: string[] = [];
  scores.forEach((score, index) => {
    if (score === null) {
      if (current.length > 1) segments.push(`M ${current.join(' L ')}`);
      current = [];
      return;
    }
    current.push(`${x(index + 1).toFixed(1)},${y(score).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(`M ${current.join(' L ')}`);

  const blunders = new Set(computeBlunders(scores));
  const hitWidth = (WIDTH - 2 * PAD_X) / Math.max(turns - first, 1);

  const pct = (score: number) => winPercent(score);
  const label = (turn: number, score: number) => {
    const swing = blunders.has(turn) ? ' — blunder swing' : '';
    return `Turn ${turn}: ${playerNames[0]} ${pct(score)}% · ${playerNames[1]} ${100 - pct(score)}%${swing}`;
  };

  return (
    <svg
      className="ps-eval-graph"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Evaluation over ${turns} turns for ${playerNames[0]} vs ${playerNames[1]}`}
    >
      <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
      {currentTurn >= 1 && currentTurn <= turns && (
        <line x1={x(currentTurn)} y1={2} x2={x(currentTurn)} y2={HEIGHT - 2} stroke="#8cf" strokeOpacity={0.45} />
      )}
      {segments.map(d => (
        <path key={d} d={d} fill="none" stroke="#cde" strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
      {hasLead && (
        <>
          {scores[0] !== null && (
            <line
              x1={x(0)} y1={y(leadScore!)} x2={x(1)} y2={y(scores[0])}
              stroke="#cde" strokeOpacity={0.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Diamond, not circle — the lead decision is a different kind of point. */}
          <rect
            x={x(0) - 2.6} y={y(leadScore!) - 2.6} width={5.2} height={5.2}
            transform={`rotate(45 ${x(0)} ${y(leadScore!)})`}
            fill={leadScore! >= 0 ? '#8ac' : '#c8a'}
            stroke="#cde" strokeWidth={0.8} vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
          <rect
            data-turn={0}
            x={x(0) - hitWidth / 2} y={0} width={hitWidth} height={HEIGHT}
            fill="transparent"
            style={onSelectTurn ? { cursor: 'pointer' } : undefined}
            onClick={onSelectTurn ? () => onSelectTurn(0) : undefined}
          >
            <title>{`Leads: ${playerNames[0]} ${pct(leadScore!)}% · ${playerNames[1]} ${100 - pct(leadScore!)}%`}</title>
          </rect>
        </>
      )}
      {scores.map((score, index) => score === null ? null : (
        <circle
          key={`p${index}`}
          cx={x(index + 1)}
          cy={y(score)}
          r={blunders.has(index + 1) ? 3.4 : 2}
          fill={score >= 0 ? '#8ac' : '#c8a'}
          stroke={blunders.has(index + 1) ? '#f3a6a6' : 'none'}
          strokeWidth={blunders.has(index + 1) ? 1.6 : 0}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {scores.map((score, index) => score === null ? null : (
        <rect
          key={`h${index}`}
          data-turn={index + 1}
          x={x(index + 1) - hitWidth / 2}
          y={0}
          width={hitWidth}
          height={HEIGHT}
          fill="transparent"
          style={onSelectTurn ? { cursor: 'pointer' } : undefined}
          onClick={onSelectTurn ? () => onSelectTurn(index + 1) : undefined}
        >
          <title>{label(index + 1, score)}</title>
        </rect>
      ))}
    </svg>
  );
}
