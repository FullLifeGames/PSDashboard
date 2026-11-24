export type HpTone = 'green' | 'yellow' | 'red';

/** Bar parts in percent of the target's maximum HP from the left; they add up to 100. */
export interface HitBarSegments {
  rest: number;
  roll: number;
  sure: number;
  lost: number;
  /** The colour of the roll's and the sure part: the share of the target's present HP that the lowest roll takes. */
  tone: HpTone;
}

const clamp = (value: number, max: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0);

export function hpTone(percent: number): HpTone {
  if (percent > 50) return 'green';
  if (percent > 20) return 'yellow';
  return 'red';
}

export function hpBarClass(percent: number): string {
  return `ps-hpbar-${hpTone(percent)}`;
}

export function hitBarSegments(hpPercent: number, minPercent: number, maxPercent: number): HitBarSegments {
  const hp = clamp(hpPercent, 100);
  const lowest = clamp(minPercent, hp);
  const highest = Math.max(clamp(maxPercent, hp), lowest);
  const share = hp > 0 ? (lowest / hp) * 100 : 0;
  return { rest: hp - highest, roll: highest - lowest, sure: lowest, lost: 100 - hp, tone: hpTone(share) };
}
