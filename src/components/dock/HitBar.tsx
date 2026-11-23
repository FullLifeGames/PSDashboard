import { hitBarSegments } from '../../lib/hit-bar';

/**
 * A target's HP bar under one hit: `rest` surely stays (grey), `roll` is what the damage roll decides (striped), `sure` what even the
 * lowest roll takes, `lost` what the target has lost already (`hitBarSegments`); the four add up to 100. The tone colors `roll` and `sure`.
 */
export function HitBar({ hp, min, max }: { hp: number; min: number; max: number }) {
  const segments = hitBarSegments(hp, min, max);
  return (
    <span className="ps-hitbar" data-tone={segments.tone} aria-hidden="true">
      <i className="ps-hitbar-rest" style={{ width: `${segments.rest}%` }} />
      <i className="ps-hitbar-roll" style={{ width: `${segments.roll}%` }} />
      <i className="ps-hitbar-sure" style={{ width: `${segments.sure}%` }} />
      <i className="ps-hitbar-lost" style={{ width: `${segments.lost}%` }} />
    </span>
  );
}
