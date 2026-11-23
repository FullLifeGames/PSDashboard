import type { SpreadOrigin } from '../spreads/ladder.ts';

/** Provenance label the stats panel shows for damage-solved spreads. */
export const INFERRED_SPREAD_DETAIL = 'fits observed damage';
/** A spread only a proven move order checked. */
export const ORDER_SPREAD_DETAIL = 'fits the observed move order';
/** A spread whose HP the log's maximum HP set inside the guess. */
export const MEASURED_HP_SPREAD_DETAIL = 'HP read from the log, the rest kept from the guess';
/** An item the move order decided: the mon moved first, so the Choice Scarf is inferred. */
export const INFERRED_ITEM_DETAIL = 'moved first, Choice Scarf inferred';
/** The mon moved second, so the Choice Scarf is ruled out. */
export const RULED_OUT_ITEM_DETAIL = 'moved second, Choice Scarf ruled out';
/** The damage lines dropped a guessed boost item. */
export const NO_BOOST_ITEM_DETAIL = 'damage rules out a boost item';
/** A knockout no spread of the set reaches, and a usage-listed boost item does. */
export const KNOCKOUT_BOOST_ITEM_DETAIL = 'only a boost item reaches the knockout';

export const ITEM_DETAIL = {
  'moved-first': INFERRED_ITEM_DETAIL, 'moved-second': RULED_OUT_ITEM_DETAIL, 'no-boost': NO_BOOST_ITEM_DETAIL, boost: KNOCKOUT_BOOST_ITEM_DETAIL,
} as const;

export const ORIGIN_DETAIL: Record<Exclude<SpreadOrigin, 'prior'>, string> = {
  damage: INFERRED_SPREAD_DETAIL, order: ORDER_SPREAD_DETAIL, hp: MEASURED_HP_SPREAD_DETAIL,
};
