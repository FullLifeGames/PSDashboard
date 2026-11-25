const TONES = ['green', 'yellow', 'red'] as const;

function ToneSwatches({ striped }: { striped: boolean }) {
  return (
    <>
      {TONES.map(tone => (
        <i key={tone} className={`ps-legend-swatch ps-legend-${striped ? 'roll' : 'sure'}-${tone}`} />
      ))}
    </>
  );
}

export function BarLegend() {
  return (
    <div className="ps-tile-legend">
      <span><ToneSwatches striped={false} />taken by even the lowest roll: green over half of the HP left, yellow over a fifth, else red</span>
      <span><ToneSwatches striped />the roll decides</span>
      <span><i className="ps-legend-swatch ps-legend-rest" />stays after the highest roll</span>
    </div>
  );
}
