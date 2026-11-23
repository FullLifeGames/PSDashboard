/**
 * The parts of the bar under a target, in percent of its maximum HP from the left: `rest` is what surely stays (after the highest
 * damage roll), `roll` what the roll decides, `sure` what even the lowest roll takes, `lost` what the target has lost already.
 * The four add up to 100.
 */
export type HpTone = 'green' | 'yellow' | 'red';

export interface HitBarSegments {
  rest: number;
  roll: number;
  sure: number;
  lost: number;
  /** The colour of the roll's and the sure part: the share of the target's present HP that the lowest roll takes. */
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

/**
 * The segments for a target at `hpPercent` hit for `minPercent` to `maxPercent` of its maximum HP. The tone reads the lowest
 * roll against the HP the target has now, so a sure knock out is always green (the thresholds of `hpTone`).
 */
export function hitBarSegments(hpPercent: number, minPercent: number, maxPercent: number): HitBarSegments {
  const hp = clamp(hpPercent, 100);
  const lowest = clamp(minPercent, hp);
  const highest = Math.max(clamp(maxPercent, hp), lowest);
  const share = hp > 0 ? (lowest / hp) * 100 : 0;
  return { rest: hp - highest, roll: highest - lowest, sure: lowest, lost: 100 - hp, tone: hpTone(share) };
}
