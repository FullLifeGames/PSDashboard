/** What an HP text of the log says about the real HP: exact points, a percentage rounded up (Generation 7 on, HP Percentage Mod) or down (Champions mod), or 48ths rounded down. */

/** The numbers before the slash of one HP text of the log (`75/100` is hp 75, maxhp 100). */
export interface HpText {
  hp: number;
  maxhp: number;
}

export type HpForm = 'exact' | 'percent-up' | 'percent-down' | 'pixels';

const PERCENT = 100;
const PIXELS = 48;

/**
 * The form of a text: a maximum of 100 is a percentage (down in the Champions mod, up elsewhere), 48 the pixel bar, any other an exact
 * reading; the log cannot tell a player's own view of a body with exactly 100 or 48 maximum HP from those forms.
 */
export function formOf(maxhp: number, champions: boolean): HpForm {
  if (maxhp === PERCENT) return champions ? 'percent-down' : 'percent-up';
  return maxhp === PIXELS ? 'pixels' : 'exact';
}

/** What the simulator prints for a body at `hp` of `maxhp` in this form: the number before the slash (0 at 0 HP). */
export function shownOf(form: HpForm, hp: number, maxhp: number): number {
  if (hp <= 0) return 0;
  if (form === 'exact') return hp;
  if (form === 'percent-up') {
    const percentage = Math.ceil(PERCENT * hp / maxhp);
    return percentage === PERCENT && hp < maxhp ? PERCENT - 1 : percentage;
  }
  const scale = form === 'pixels' ? PIXELS : PERCENT;
  return Math.floor(scale * hp / maxhp) || 1;
}

/** The lowest and highest HP, in points of a body with `realMax` maximum HP, that print as the text. */
export interface HpBounds {
  lowest: number;
  highest: number;
}

/**
 * The lowest and highest real HP a shown text allows for a body with `realMax` maximum HP, or null when none does; an exact text on a body
 * of another maximum HP keeps the shown ratio.
 */
export function hpBoundsOf(shown: HpText, realMax: number, champions: boolean): HpBounds | null {
  const form = formOf(shown.maxhp, champions);
  if (realMax < 1 || shown.hp < 1) return null;
  if (form === 'exact') {
    const hp = shown.maxhp === realMax ? shown.hp : shown.hp / shown.maxhp * realMax;
    return { lowest: hp, highest: hp };
  }
  const scale = form === 'pixels' ? PIXELS : PERCENT;
  const { hp } = shown;
  if (hp > scale) return null;
  if (hp === scale) return { lowest: realMax, highest: realMax };
  let lowest: number;
  let highest: number;
  if (form === 'percent-up') {
    // ceil(100 hp / max) = shown, and shown 99 also holds every HP below full that ceils to 100.
    lowest = Math.floor((hp - 1) * realMax / scale) + 1;
    highest = hp === scale - 1 ? realMax - 1 : Math.floor(hp * realMax / scale);
  } else {
    // floor(scale hp / max) || 1 = shown, and shown 1 also holds the HP that floors to 0.
    lowest = hp === 1 ? 1 : Math.ceil(hp * realMax / scale);
    highest = Math.ceil((hp + 1) * realMax / scale) - 1;
  }
  return lowest <= highest ? { lowest, highest } : null;
}

/**
 * The least damage a hit shown as `before` (and, when the body stood, `after`) did: the lowest HP the first text allows less the highest
 * the second allows; null when a text allows no HP of this body (no bound).
 */
export function leastDamageOf(shown: { before: HpText; after?: HpText }, realMax: number, champions: boolean): number | null {
  const before = hpBoundsOf(shown.before, realMax, champions);
  if (!before) return null;
  if (!shown.after) return before.lowest;
  const after = hpBoundsOf(shown.after, realMax, champions);
  return after ? Math.max(0, before.lowest - after.highest) : null;
}
