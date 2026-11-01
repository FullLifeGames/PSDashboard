/**
 * Round 84 (turn dock), lane A: the parts of the bar under a target. It shows the target's HP and what one hit does to it, in
 * percent of its maximum HP and from the left: `solid` is what surely stays (after the highest damage roll), `striped` what the
 * roll decides, `ghost` what even the lowest roll takes, `lost` what the target has lost already. The four add up to 100.
 */
export type HpTone = 'green' | 'yellow' | 'red';

export interface HitBarSegments {
  solid: number;
  striped: number;
  ghost: number;
  lost: number;
  /** The colour of the solid and striped parts: the HP left after the highest roll. */
  tone: HpTone;
}

const clamp = (value: number, max: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0);

/** The app's HP colours: above 50 % green, above 20 % yellow, else red. */
export function hpTone(percent: number): HpTone {
  if (percent > 50) return 'green';
  if (percent > 20) return 'yellow';
  return 'red';
}

/** The class of an HP bar's fill in `pickers.css`. */
export function hpBarClass(percent: number): string {
  return `ps-hpbar-${hpTone(percent)}`;
}

/** The segments for a target at `hpPercent` hit for `minPercent` to `maxPercent` of its maximum HP. */
export function hitBarSegments(hpPercent: number, minPercent: number, maxPercent: number): HitBarSegments {
  const hp = clamp(hpPercent, 100);
  const lowest = clamp(minPercent, hp);
  const highest = Math.max(clamp(maxPercent, hp), lowest);
  const solid = hp - highest;
  return { solid, striped: highest - lowest, ghost: lowest, lost: 100 - hp, tone: hpTone(solid) };
}
