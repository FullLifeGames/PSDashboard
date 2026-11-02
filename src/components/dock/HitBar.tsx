import { hitBarSegments } from '../../lib/hit-bar';

/**
 * Round 84 (turn dock): a target's HP bar under one hit. Solid is what surely stays, striped what the damage roll decides,
 * ghost what even the lowest roll takes, lost what the target has lost already (`hitBarSegments`). The four add up to 100.
 */
export function HitBar({ hp, min, max }: { hp: number; min: number; max: number }) {
  const segments = hitBarSegments(hp, min, max);
  return (
    <span className="ps-hitbar" data-tone={segments.tone} aria-hidden="true">
      <i className="ps-hitbar-solid" style={{ width: `${segments.solid}%` }} />
      <i className="ps-hitbar-striped" style={{ width: `${segments.striped}%` }} />
      <i className="ps-hitbar-ghost" style={{ width: `${segments.ghost}%` }} />
      <i className="ps-hitbar-lost" style={{ width: `${segments.lost}%` }} />
    </span>
  );
}
