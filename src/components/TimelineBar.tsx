import { sliderMax, variationTip } from '../lib/timeline';
import type { TimelinePosition, VariationSpan, ViewLine } from '../lib/timeline';

interface TimelineBarProps {
  viewT0: boolean;
  viewTurn: number;
  viewLine: ViewLine;
  variationSpan: VariationSpan | null;
  maxTurn: number;
  endSnapshotTurn: number | null;
  atEndPosition: boolean;
  viewingVariation: boolean;
  branching: boolean;
  onNavigate: (position: TimelinePosition) => void;
  onGraphSelectLine: (turn: number) => void;
  onDiscard: () => void;
}

function VariationStripe({ variationSpan, maxTurn }: { variationSpan: VariationSpan; maxTurn: number }) {
  // Gold stripe under the slider marking where the variation
  // lives — without it nothing on the timeline said so.
  const max = sliderMax(maxTurn, variationSpan);
  const pos = (turn: number) => (max <= 1 ? 0 : ((turn - 1) / (max - 1)) * 100);
  // A turn-0 variation starts left of the slider's domain.
  const from = Math.max(0, pos(variationSpan.startTurn));
  const to = pos(variationTip(variationSpan));
  return (
    <span
      className="ps-timeline-stripe"
      style={{ left: `${from}%`, width: `${Math.max(to - from, 0.8)}%` }}
      title={`Variation: turns ${variationSpan.startTurn}–${variationTip(variationSpan)}`}
    />
  );
}

function TimelinePositionLabel({ viewT0, viewTurn, variationSpan, maxTurn, endSnapshotTurn, atEndPosition, viewingVariation }: Pick<TimelineBarProps,
  'viewT0' | 'viewTurn' | 'variationSpan' | 'maxTurn' | 'endSnapshotTurn' | 'atEndPosition' | 'viewingVariation'>) {
  return (
    <span style={{ fontSize: 11, color: '#aab', minWidth: 60, textAlign: 'center' }}>
      {viewT0 ? (
        <strong style={{ color: '#fff' }}>T0</strong>
      ) : atEndPosition && !viewingVariation ? (
        <strong style={{ color: '#fff' }}>End</strong>
      ) : (
        <>
          {/* The total counts PLAYED turns — the end snapshot is the
              "End" sentinel, not a 68th turn of a 67-turn game. */}
          T<strong style={{ color: '#fff' }}>{viewTurn}</strong>/{sliderMax(endSnapshotTurn !== null ? endSnapshotTurn - 1 : maxTurn, variationSpan)}
        </>
      )}
    </span>
  );
}

function TimelineLineChip({ viewTurn, variationSpan, maxTurn, viewingVariation, onNavigate }: Pick<TimelineBarProps,
  'viewTurn' | 'maxTurn' | 'viewingVariation' | 'onNavigate'> & { variationSpan: VariationSpan }) {
  return (
    <span className="ps-line-chip" role="group" aria-label="Line selector">
      <button
        type="button"
        className={!viewingVariation ? 'on-main' : ''}
        onClick={() => onNavigate({ turn: Math.min(viewTurn, maxTurn), line: 'main' })}
      >Main line</button>
      <button
        type="button"
        className={viewingVariation ? 'on-vari' : ''}
        onClick={() => onNavigate({
          turn: Math.min(Math.max(viewTurn, variationSpan.startTurn + 1), variationTip(variationSpan)),
          line: 'variation',
        })}
      >Variation</button>
    </span>
  );
}

function TimelineTrack({ viewTurn, viewLine, variationSpan, maxTurn, onNavigate }: Pick<TimelineBarProps,
  'viewTurn' | 'viewLine' | 'variationSpan' | 'maxTurn' | 'onNavigate'>) {
  return (
    <span className="ps-timeline-track">
      {variationSpan && <VariationStripe variationSpan={variationSpan} maxTurn={maxTurn} />}
      <input
        type="range"
        min={1}
        max={sliderMax(maxTurn, variationSpan)}
        value={viewTurn}
        onChange={e => onNavigate({ turn: parseInt(e.target.value, 10), line: viewLine })}
        aria-label="Timeline turn selector"
      />
    </span>
  );
}

function TimelineBackControls({ viewT0, viewTurn, viewLine, onNavigate, onGraphSelectLine }: Pick<TimelineBarProps,
  'viewT0' | 'viewTurn' | 'viewLine' | 'onNavigate' | 'onGraphSelectLine'>) {
  return (
    <>
      <button
        type="button"
        className="ps-btn"
        onClick={() => onGraphSelectLine(0)}
        title="Turn 0: team preview. Pick different leads and play the game from the start."
        aria-pressed={viewT0}
        style={{
          padding: '2px 6px', fontSize: 10,
          ...(viewT0 ? { borderColor: '#8cf', color: '#8cf' } : {}),
        }}
      >T0</button>
      <button
        type="button"
        onClick={() => (viewTurn <= 1 && !viewT0
          ? onGraphSelectLine(0)
          : onNavigate({ turn: viewTurn - 1, line: viewLine }))}
        disabled={viewTurn <= 1 && viewT0}
        className="ps-btn"
        style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
      >&#9664;</button>
    </>
  );
}

/** Timeline bar: always visible — one slider over main line and variation. */
export function TimelineBar(props: TimelineBarProps) {
  const { viewT0, viewTurn, viewLine, variationSpan, maxTurn, branching, onNavigate, onGraphSelectLine, onDiscard } = props;
  return (
    <div className="ps-branch-bar">
      <span style={{ fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap', color: '#cde' }}>Timeline</span>
      <TimelineBackControls viewT0={viewT0} viewTurn={viewTurn} viewLine={viewLine} onNavigate={onNavigate} onGraphSelectLine={onGraphSelectLine} />
      <TimelineTrack viewTurn={viewTurn} viewLine={viewLine} variationSpan={variationSpan} maxTurn={maxTurn} onNavigate={onNavigate} />
      <button
        type="button"
        onClick={() => onNavigate({ turn: viewT0 ? 1 : viewTurn + 1, line: viewLine })}
        disabled={!viewT0 && viewTurn >= sliderMax(maxTurn, variationSpan)}
        className="ps-btn"
        style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
      >&#9654;</button>
      <TimelinePositionLabel
        viewT0={viewT0}
        viewTurn={viewTurn}
        variationSpan={variationSpan}
        maxTurn={maxTurn}
        endSnapshotTurn={props.endSnapshotTurn}
        atEndPosition={props.atEndPosition}
        viewingVariation={props.viewingVariation}
      />
      {/* The chip stays put while a variation exists — flickering away
          outside the covered turns made the whole bar jump around. */}
      {variationSpan !== null && (
        <TimelineLineChip
          viewTurn={viewTurn}
          variationSpan={variationSpan}
          maxTurn={maxTurn}
          viewingVariation={props.viewingVariation}
          onNavigate={onNavigate}
        />
      )}
      {(variationSpan !== null || branching) && (
        <button
          type="button"
          className="ps-btn ps-btn-red"
          onClick={onDiscard}
          title="Drops every played variation move."
          style={{ padding: '3px 10px', fontSize: 11 }}
        >
          Discard variation
        </button>
      )}
    </div>
  );
}
