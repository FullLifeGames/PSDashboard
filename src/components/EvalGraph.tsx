import { computeBlunders } from '../lib/eval/graph';
import { winPercent } from '../lib/eval/winprob';

interface EvalGraphProps {
  /** scores[t-1] = score at turn t (p1 perspective, [-1,1]); null = gap. */
  scores: (number | null)[];
  playerNames: [string, string];
  currentTurn: number;
  onSelectTurn?: (turn: number) => void;
  /** Selects the fitted win-probability curve for percent labels. */
  doubles?: boolean;
}

const WIDTH = 300;
const HEIGHT = 64;
const PAD_X = 4;

/**
 * Chess-style evaluation line over the whole game. Single series (no legend
 * needed); point color carries the polarity via the app's player colors;
 * blunder markers add a shape ring plus tooltip text, never color alone.
 */
export function EvalGraph({ scores, playerNames, currentTurn, onSelectTurn, doubles }: EvalGraphProps) {
  const turns = scores.length;
  if (turns === 0) return null;

  const x = (turn: number) => turns === 1
    ? WIDTH / 2
    : PAD_X + ((turn - 1) / (turns - 1)) * (WIDTH - 2 * PAD_X);
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
  const hitWidth = (WIDTH - 2 * PAD_X) / Math.max(turns - 1, 1);

  const pct = (score: number) => winPercent(score, doubles);
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
