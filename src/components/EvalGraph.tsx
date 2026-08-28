import { useLayoutEffect, useRef, useState } from 'react';
import { computeBlunders } from '../lib/eval/graph';
import { winPercent } from '../lib/eval/winprob';

interface EvalGraphProps {
  /** scores[t-1] = score at turn t (p1 perspective, [-1,1]); null = gap. */
  scores: (number | null)[];
  playerNames: [string, string];
  currentTurn: number;
  /** Which line the pointer sits on — the ring marker follows it. */
  currentLine?: 'main' | 'variation';
  onSelectTurn?: (turn: number, line?: 'main' | 'variation') => void;
  /**
   * Variation overlay (unified timeline): gold curve anchored at the branch
   * point's main value; scores indexed like the main array (scores[t-1]),
   * filled only for played variation positions. Gaps stay gaps — no
   * invented values.
   */
  variation?: { startTurn: number; scores: (number | null)[] } | null;
  /** Turn 0 (team preview) game value — adds a leads point before turn 1. */
  leadScore?: number | null;
  /** evalErrors[t-1] = why turn t has no point (eval-layer failure). */
  evalErrors?: (string | null)[];
  /**
   * decided[t-1] = the turn's decided-sweep state (round 15): the board is
   * practically over for `side`. Rendered as a thin strip on that side's
   * edge (top = p1, bottom = p2) plus a node-label note — the calibrated
   * line itself stays honest.
   */
  decided?: ({ side: 'p1' | 'p2'; species: string } | null)[];
  /**
   * Full main-line length. Keeps the x-domain honest when nothing has been
   * analyzed yet — without it a lone variation collapsed the axis to its own
   * few turns and rendered at the far right of an empty box.
   */
  maxTurn?: number;
}

const HEIGHT = 72;
const PAD_X = 6;
const MAIN_COLOR = '#7cb7e8';
const VARIATION_COLOR = '#f0c76b';

/**
 * Chess-style evaluation line over the whole game. Single series (no legend
 * needed); point color carries the polarity via the app's player colors;
 * blunder markers add a shape ring plus tooltip text, never color alone.
 *
 * The viewBox tracks the rendered width 1:1 (ResizeObserver) — a fixed
 * viewBox stretched with preserveAspectRatio="none" turned every circle
 * into a viewport-dependent ellipse (fills scale even where strokes are
 * protected), so markers looked different on desktop and mobile.
 */
export function EvalGraph({ scores, playerNames, currentTurn, currentLine, onSelectTurn, leadScore, evalErrors, decided, variation, maxTurn }: EvalGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(300);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(previous => (Math.abs(previous - measured) > 1 ? Math.max(120, measured) : previous));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const turns = scores.length;
  // The x-domain stretches past the replay when the variation is longer.
  const lastVariationTurn = variation
    ? variation.scores.reduce<number>((max, value, index) => (value !== null ? index + 1 : max), 0)
    : 0;
  const lastTurn = Math.max(turns, lastVariationTurn, maxTurn ?? 0);
  if (lastTurn === 0) return null;

  // With a lead evaluation the x-domain starts at turn 0 (team preview).
  const hasLead = leadScore !== null && leadScore !== undefined;
  const first = hasLead ? 0 : 1;
  const x = (turn: number) => lastTurn === first
    ? width / 2
    : PAD_X + ((turn - first) / (lastTurn - first)) * (width - 2 * PAD_X);
  const y = (score: number) => HEIGHT / 2 - score * (HEIGHT / 2 - 7);

  // Consecutive non-null runs become path segments; gaps get a faint dashed
  // connector so an isolated final point (late-game reconstruction gaps end
  // in the decided ±1 position) reads as the line's ending, not debris.
  const segments: string[] = [];
  const gapLinks: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let current: string[] = [];
  let previousPoint: { x: number; y: number } | null = null;
  let inGap = false;
  scores.forEach((score, index) => {
    if (score === null) {
      if (current.length > 1) segments.push(`M ${current.join(' L ')}`);
      current = [];
      inGap = previousPoint !== null;
      return;
    }
    const px = x(index + 1);
    const py = y(score);
    if (inGap && previousPoint) {
      gapLinks.push({ x1: previousPoint.x, y1: previousPoint.y, x2: px, y2: py });
      inGap = false;
    }
    current.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    previousPoint = { x: px, y: py };
  });
  if (current.length > 1) segments.push(`M ${current.join(' L ')}`);

  const blunders = new Set(computeBlunders(scores));
  const hitWidth = (width - 2 * PAD_X) / Math.max(lastTurn - first, 1);

  // Variation overlay: anchored at the branch point's main value; points
  // are only the ACTUALLY evaluated variation positions.
  const variationPoints: { turn: number; px: number; py: number; score: number }[] = [];
  let variationPath = '';
  if (variation) {
    const anchorScore = scores[variation.startTurn - 1];
    const coords: string[] = anchorScore !== null && anchorScore !== undefined
      ? [`${x(variation.startTurn).toFixed(1)},${y(anchorScore).toFixed(1)}`]
      : [];
    variation.scores.forEach((score, index) => {
      const turn = index + 1;
      if (score === null || score === undefined || turn <= variation.startTurn) return;
      const px = x(turn);
      const py = y(score);
      coords.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      variationPoints.push({ turn, px, py, score });
    });
    if (coords.length > 1) variationPath = `M ${coords.join(' L ')}`;
  }
  const variationEnd = variationPoints.length > 0
    ? variationPoints[variationPoints.length - 1].turn
    : (variation ? variation.startTurn + 1 : 0);

  // Round 15: consecutive decided turns of the same side become one thin
  // strip along that side's edge; a lone decided turn draws as a dot (round
  // linecap). The calibrated line itself is never bent.
  const decidedSpans: { x1: number; x2: number; side: 'p1' | 'p2'; species: string }[] = [];
  if (decided) {
    let run: { start: number; end: number; side: 'p1' | 'p2'; species: string } | null = null;
    const flush = () => {
      if (run) decidedSpans.push({ x1: x(run.start), x2: x(run.end), side: run.side, species: run.species });
      run = null;
    };
    decided.forEach((signal, index) => {
      const turn = index + 1;
      if (!signal || scores[index] === null) { flush(); return; }
      if (run && run.side === signal.side) { run.end = turn; return; }
      flush();
      run = { start: turn, end: turn, side: signal.side, species: signal.species };
    });
    flush();
  }

  const pct = (score: number) => winPercent(score);
  // A node IS the estimate before its turn; the movement INTO it was the
  // previous turn's doing. Clicks stay on the node's own turn (a shifted
  // click felt like landing one node back) — the tooltip names the producer
  // and the selection glow shows the clicked turn's own movement.
  const label = (turn: number, score: number) => {
    const swing = blunders.has(turn) ? ' · blunder swing' : '';
    const producer = turn - 1 >= first ? (turn - 1 === 0 ? 'the lead decision' : `turn ${turn - 1}`) : null;
    const arrival = producer ? ` (what ${producer} produced)` : '';
    const state = decided?.[turn - 1];
    const decidedNote = state ? ` · practically decided: ${state.species}` : '';
    return `Before turn ${turn}${arrival}: ${playerNames[0]} ${pct(score)}% · ${playerNames[1]} ${100 - pct(score)}%${swing}${decidedNote}`;
  };

  // The selected turn's movement: its node → the next node (what that play
  // produced), drawn as a thicker glow under the line.
  const edgeFrom = currentTurn >= 1 ? scores[currentTurn - 1] : (hasLead ? leadScore! : null);
  const edgeTo = currentTurn >= 0 && currentTurn < turns ? scores[currentTurn] : null;
  const highlight = edgeFrom !== null && edgeFrom !== undefined && edgeTo !== null && currentTurn >= first
    ? { x1: x(currentTurn), y1: y(edgeFrom), x2: x(currentTurn + 1), y2: y(edgeTo) }
    : null;

  return (
    <svg
      ref={svgRef}
      className="ps-eval-graph"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-label={`Evaluation over ${turns} turns for ${playerNames[0]} vs ${playerNames[1]}`}
    >
      {/* Mockup look: inset dark panel, emphasized zero line, faint ±0.5 grid. */}
      <rect x={0.5} y={0.5} width={Math.max(width - 1, 1)} height={HEIGHT - 1} rx={6}
        fill="rgba(0,0,0,0.18)" stroke="rgba(183,216,255,0.16)" />
      <line x1={PAD_X} y1={y(0.5)} x2={width - PAD_X} y2={y(0.5)} stroke="rgba(183,216,255,0.08)" />
      <line x1={PAD_X} y1={y(-0.5)} x2={width - PAD_X} y2={y(-0.5)} stroke="rgba(183,216,255,0.08)" />
      <line x1={PAD_X} y1={HEIGHT / 2} x2={width - PAD_X} y2={HEIGHT / 2} stroke="rgba(183,216,255,0.22)" />
      {variation && (() => {
        // A turn-0 variation (lead branch) starts left of the axis — its
        // marker clamps to the first plotted turn.
        const markerTurn = Math.max(variation.startTurn, first);
        return (
          <>
            <rect
              x={x(markerTurn)} y={2}
              width={Math.max(2, x(Math.max(variationEnd, markerTurn + 1)) - x(markerTurn))}
              height={HEIGHT - 4} fill="rgba(240,199,107,0.07)"
            />
            <line
              x1={x(markerTurn)} x2={x(markerTurn)} y1={2} y2={HEIGHT - 2}
              stroke="rgba(240,199,107,0.5)" strokeDasharray="3 3"
            />
          </>
        );
      })()}
      {decidedSpans.map(span => (
        <line
          key={`d${span.x1}-${span.x2}-${span.side}`}
          x1={span.x1} x2={span.x2}
          y1={span.side === 'p1' ? 3 : HEIGHT - 3}
          y2={span.side === 'p1' ? 3 : HEIGHT - 3}
          stroke="#cde" strokeOpacity={0.55} strokeWidth={2.5} strokeLinecap="round"
        >
          <title>practically decided: {span.species}</title>
        </line>
      ))}
      {currentTurn >= 1 && currentTurn <= lastTurn && (
        <line x1={x(currentTurn)} y1={2} x2={x(currentTurn)} y2={HEIGHT - 2} stroke="#8cf" strokeOpacity={0.3} />
      )}
      {highlight && (
        <line
          x1={highlight.x1} y1={highlight.y1} x2={highlight.x2} y2={highlight.y2}
          stroke="#8cf" strokeOpacity={0.55} strokeWidth={3.5} strokeLinecap="round"
        />
      )}
      {segments.map(d => (
        <path key={d} d={d} fill="none" stroke={MAIN_COLOR} strokeWidth={1.6} strokeLinejoin="round" />
      ))}
      {gapLinks.map(link => (
        <line
          key={`g${link.x1}-${link.x2}`}
          x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}
          stroke={MAIN_COLOR} strokeOpacity={0.35} strokeDasharray="3 2"
        />
      ))}
      {variationPath && (
        <path d={variationPath} fill="none" stroke={VARIATION_COLOR} strokeWidth={1.8} strokeLinejoin="round" />
      )}
      {variationPoints.map(point => (
        <circle key={`v${point.turn}`} cx={point.px} cy={point.py} r={2.2} fill={VARIATION_COLOR} />
      ))}
      {hasLead && (
        <>
          {scores[0] !== null && (
            <line
              x1={x(0)} y1={y(leadScore!)} x2={x(1)} y2={y(scores[0])}
              stroke="#cde" strokeOpacity={0.5} strokeDasharray="3 2"
            />
          )}
          {/* Diamond, not circle — the lead decision is a different kind of
              point, drawn larger so it reads as its own clickable stop. */}
          <rect
            x={x(0) - 3.4} y={y(leadScore!) - 3.4} width={6.8} height={6.8}
            transform={`rotate(45 ${x(0)} ${y(leadScore!)})`}
            fill={leadScore! >= 0 ? '#8ac' : '#c8a'}
            stroke="#cde" strokeWidth={1}
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
        />
      ))}
      {scores.map((score, index) => (
        <rect
          key={`h${index}`}
          data-turn={index + 1}
          x={x(index + 1) - hitWidth / 2}
          y={0}
          width={hitWidth}
          height={HEIGHT}
          fill="transparent"
          style={onSelectTurn ? { cursor: 'pointer' } : undefined}
          onClick={onSelectTurn ? () => onSelectTurn(index + 1, 'main') : undefined}
        >
          {/* Gap turns (reconstruction wedges, unswept ends) stay clickable —
              the turn view then offers "Analyze this position". */}
          <title>{score === null
            ? (evalErrors?.[index]
              ? `Turn ${index + 1} · could not be evaluated: ${evalErrors[index]} · click to open`
              : `Turn ${index + 1} · not analyzed yet · click to open, then Analyze this position`)
            : label(index + 1, score)}</title>
        </rect>
      ))}
      {/* Variation hits render AFTER the main hits so they win the overlap;
          narrower than a full column — the main line stays clickable around
          each gold point. */}
      {variationPoints.map(point => (
        <rect
          key={`vh${point.turn}`}
          data-turn={point.turn}
          data-line="variation"
          x={point.px - hitWidth / 4}
          y={0}
          width={hitWidth / 2}
          height={HEIGHT}
          fill="transparent"
          style={onSelectTurn ? { cursor: 'pointer' } : undefined}
          onClick={onSelectTurn ? () => onSelectTurn(point.turn, 'variation') : undefined}
        >
          <title>{`Variation, before turn ${point.turn}: ${playerNames[0]} ${pct(point.score)}% · ${playerNames[1]} ${100 - pct(point.score)}%`}</title>
        </rect>
      ))}
      {/* Ring marker: the pointer's position on ITS line. */}
      {(() => {
        const score = currentLine === 'variation'
          ? variation?.scores[currentTurn - 1] ?? null
          : (currentTurn >= 1 ? scores[currentTurn - 1] ?? null : (hasLead && currentTurn === 0 ? leadScore! : null));
        if (score === null || score === undefined || currentTurn < first) return null;
        return (
          <circle
            cx={x(currentTurn)} cy={y(score)} r={4.5}
            fill="none" stroke="#fff" strokeWidth={1.6}
            style={{ pointerEvents: 'none' }}
          />
        );
      })()}
    </svg>
  );
}
