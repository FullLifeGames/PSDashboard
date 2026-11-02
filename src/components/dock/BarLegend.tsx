const TONES = ['green', 'yellow', 'red'] as const;

/** Three swatches, one per tone, for a part that takes the tone of the hit; `striped` draws the roll's pattern. */
function ToneSwatches({ striped }: { striped: boolean }) {
  return (
    <>
      {TONES.map(tone => (
        <i key={tone} className={`ps-legend-swatch ps-legend-${striped ? 'roll' : 'sure'}-${tone}`} />
      ))}
    </>
  );
}

/**
 * Round 84 (turn dock), A7b: the line under the move tiles that says what the three parts of a hit bar mean (variant F). The
 * part the lowest roll takes and the roll's part carry the hit's tone, so each shows its three colors; what stays is grey.
 */
export function BarLegend() {
  return (
    <div className="ps-tile-legend">
      <span><ToneSwatches striped={false} />taken by even the lowest roll: green over half of the HP left, yellow over a fifth, else red</span>
      <span><ToneSwatches striped />the roll decides</span>
      <span><i className="ps-legend-swatch ps-legend-rest" />stays after the highest roll</span>
    </div>
  );
}
