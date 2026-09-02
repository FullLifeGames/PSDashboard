import { useLayoutEffect, useRef, useState } from 'react';
import type { LeadAnalysis } from '@fulllifegames/eval-engine';
import {
  decidedSpans, graphBlunders, graphScales, GRAPH_HEIGHT as HEIGHT, GRAPH_PAD_X as PAD_X, highlightEdge, hitTitle,
  lastVariationTurnOf, leadTooltip, mainLinePaths, ringScore, variationHitTitle, variationOverlay,
  type DecidedSignal, type DecidedSpan, type GapLink, type GraphScales, type VariationPoint, type VariationSeries,
} from '../lib/eval-graph-view';

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
  variation?: VariationSeries | null;
  /** Turn 0 (team preview) game value — adds a leads point before turn 1. */
  leadScore?: number | null;
  /** Best and played lead per side — the T0 diamond's tooltip names them. */
  leadDetail?: LeadAnalysis | null;
  /** evalErrors[t-1] = why turn t has no point (eval-layer failure). */
  evalErrors?: (string | null)[];
  /**
   * decided[t-1] = the turn's decided-sweep state (round 15): the board is
   * practically over for `side`. Rendered as a thin strip on that side's
   * edge (top = p1, bottom = p2) plus a node-label note — the calibrated
   * line itself stays honest.
   */
  decided?: DecidedSignal[];
  /**
   * Full main-line length. Keeps the x-domain honest when nothing has been
   * analyzed yet — without it a lone variation collapsed the axis to its own
   * few turns and rendered at the far right of an empty box.
   */
  maxTurn?: number;
}

const MAIN_COLOR = '#7cb7e8';
const VARIATION_COLOR = '#f0c76b';

type SelectTurn = EvalGraphProps['onSelectTurn'];

/**
 * The viewBox tracks the rendered width 1:1 (ResizeObserver) — a fixed
 * viewBox stretched with preserveAspectRatio="none" turned every circle
 * into a viewport-dependent ellipse (fills scale even where strokes are
 * protected), so markers looked different on desktop and mobile.
 */
function useMeasuredWidth() {
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
  return { svgRef, width };
}

/* Mockup look: inset dark panel, emphasized zero line, faint ±0.5 grid. */
function GraphFrame({ width, y }: { width: number; y: GraphScales['y'] }) {
  return (
    <>
      <rect x={0.5} y={0.5} width={Math.max(width - 1, 1)} height={HEIGHT - 1} rx={6}
        fill="rgba(0,0,0,0.18)" stroke="rgba(183,216,255,0.16)" />
      <line x1={PAD_X} y1={y(0.5)} x2={width - PAD_X} y2={y(0.5)} stroke="rgba(183,216,255,0.08)" />
      <line x1={PAD_X} y1={y(-0.5)} x2={width - PAD_X} y2={y(-0.5)} stroke="rgba(183,216,255,0.08)" />
      <line x1={PAD_X} y1={HEIGHT / 2} x2={width - PAD_X} y2={HEIGHT / 2} stroke="rgba(183,216,255,0.22)" />
    </>
  );
}

/* A turn-0 variation (lead branch) starts left of the axis — its
   marker clamps to the first plotted turn. */
function VariationBand({ variation, first, variationEnd, x }: { variation: VariationSeries; first: number; variationEnd: number; x: GraphScales['x'] }) {
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
}

function DecidedStrips({ spans }: { spans: DecidedSpan[] }) {
  return (
    <>
      {spans.map(span => (
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
    </>
  );
}

function MainLine({ segments, gapLinks }: { segments: string[]; gapLinks: GapLink[] }) {
  return (
    <>
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
    </>
  );
}

function VariationLine({ path, points }: { path: string; points: VariationPoint[] }) {
  return (
    <>
      {path && (
        <path d={path} fill="none" stroke={VARIATION_COLOR} strokeWidth={1.8} strokeLinejoin="round" />
      )}
      {points.map(point => (
        <circle key={`v${point.turn}`} cx={point.px} cy={point.py} r={2.2} fill={VARIATION_COLOR} />
      ))}
    </>
  );
}

function LeadPoint({ scores, leadScore, leadDetail, playerNames, hitWidth, scales: { x, y }, onSelectTurn }: {
  scores: (number | null)[]; leadScore: number; leadDetail?: LeadAnalysis | null; playerNames: [string, string];
  hitWidth: number; scales: GraphScales; onSelectTurn: SelectTurn;
}) {
  return (
    <>
      {scores[0] !== null && (
        <line
          x1={x(0)} y1={y(leadScore)} x2={x(1)} y2={y(scores[0])}
          stroke="#cde" strokeOpacity={0.5} strokeDasharray="3 2"
        />
      )}
      {/* Diamond, not circle — the lead decision is a different kind of
          point, drawn larger so it reads as its own clickable stop. */}
      <rect
        x={x(0) - 3.4} y={y(leadScore) - 3.4} width={6.8} height={6.8}
        transform={`rotate(45 ${x(0)} ${y(leadScore)})`}
        fill={leadScore >= 0 ? '#8ac' : '#c8a'}
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
        <title>{leadTooltip(playerNames, leadScore, leadDetail)}</title>
      </rect>
    </>
  );
}

function MainPoints({ scores, blunders, scales: { x, y } }: { scores: (number | null)[]; blunders: Set<number>; scales: GraphScales }) {
  return (
    <>
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
    </>
  );
}

function MainHits({ scores, hitWidth, x, onSelectTurn, titleArgs }: {
  scores: (number | null)[]; hitWidth: number; x: GraphScales['x']; onSelectTurn: SelectTurn;
  titleArgs: { evalErrors: (string | null)[] | undefined; blunders: Set<number>; first: number; decided: DecidedSignal[] | undefined; playerNames: [string, string] };
}) {
  return (
    <>
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
          <title>{hitTitle({ ...titleArgs, index, score })}</title>
        </rect>
      ))}
    </>
  );
}

/* Variation hits render AFTER the main hits so they win the overlap;
   narrower than a full column — the main line stays clickable around
   each gold point. */
function VariationHits({ points, hitWidth, playerNames, onSelectTurn }: {
  points: VariationPoint[]; hitWidth: number; playerNames: [string, string]; onSelectTurn: SelectTurn;
}) {
  return (
    <>
      {points.map(point => (
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
          <title>{variationHitTitle(playerNames, point)}</title>
        </rect>
      ))}
    </>
  );
}

/**
 * Chess-style evaluation line over the whole game. Single series (no legend
 * needed); point color carries the polarity via the app's player colors;
 * blunder markers add a shape ring plus tooltip text, never color alone.
 */
export function EvalGraph({ scores, playerNames, currentTurn, currentLine, onSelectTurn, leadScore, leadDetail, evalErrors, decided, variation, maxTurn }: EvalGraphProps) {
  const { svgRef, width } = useMeasuredWidth();

  const turns = scores.length;
  const lastTurn = Math.max(turns, lastVariationTurnOf(variation), maxTurn ?? 0);
  if (lastTurn === 0) return null;

  // With a lead evaluation the x-domain starts at turn 0 (team preview).
  const hasLead = leadScore !== null && leadScore !== undefined;
  const first = hasLead ? 0 : 1;
  const scales = graphScales(width, first, lastTurn);
  const { x, y } = scales;
  const { segments, gapLinks } = mainLinePaths(scores, scales);
  const blunders = graphBlunders(scores);
  const hitWidth = (width - 2 * PAD_X) / Math.max(lastTurn - first, 1);
  const overlay = variationOverlay(variation, scores, scales);
  const spans = decidedSpans(decided, scores, x);
  const highlight = highlightEdge({ currentTurn, scores, hasLead, leadScore, first, scales });
  const ring = ringScore({ currentLine, variation, scores, currentTurn, hasLead, leadScore, first });
  const titleArgs = { evalErrors, blunders, first, decided, playerNames };

  return (
    <svg
      ref={svgRef}
      className="ps-eval-graph"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-label={`Evaluation over ${turns} turns for ${playerNames[0]} vs ${playerNames[1]}`}
    >
      <GraphFrame width={width} y={y} />
      {variation && <VariationBand variation={variation} first={first} variationEnd={overlay.end} x={x} />}
      <DecidedStrips spans={spans} />
      {currentTurn >= 1 && currentTurn <= lastTurn && (
        <line x1={x(currentTurn)} y1={2} x2={x(currentTurn)} y2={HEIGHT - 2} stroke="#8cf" strokeOpacity={0.3} />
      )}
      {highlight && (
        <line
          x1={highlight.x1} y1={highlight.y1} x2={highlight.x2} y2={highlight.y2}
          stroke="#8cf" strokeOpacity={0.55} strokeWidth={3.5} strokeLinecap="round"
        />
      )}
      <MainLine segments={segments} gapLinks={gapLinks} />
      <VariationLine path={overlay.path} points={overlay.points} />
      {hasLead && (
        <LeadPoint scores={scores} leadScore={leadScore} leadDetail={leadDetail} playerNames={playerNames} hitWidth={hitWidth} scales={scales} onSelectTurn={onSelectTurn} />
      )}
      <MainPoints scores={scores} blunders={blunders} scales={scales} />
      <MainHits scores={scores} hitWidth={hitWidth} x={x} onSelectTurn={onSelectTurn} titleArgs={titleArgs} />
      <VariationHits points={overlay.points} hitWidth={hitWidth} playerNames={playerNames} onSelectTurn={onSelectTurn} />
      {/* Ring marker: the pointer's position on ITS line. */}
      {ring !== null && (
        <circle
          cx={x(currentTurn)} cy={y(ring)} r={4.5}
          fill="none" stroke="#fff" strokeWidth={1.6}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}
