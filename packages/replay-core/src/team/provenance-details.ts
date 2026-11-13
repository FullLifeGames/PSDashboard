import type { SpreadOrigin } from '../spreads/ladder.ts';

/** Provenance label the stats panel shows for damage-solved spreads. */
export const INFERRED_SPREAD_DETAIL = 'fits observed damage';
/** A spread only a proven move order checked (round 69, T69). */
export const ORDER_SPREAD_DETAIL = 'fits the observed move order';
/** A spread whose HP the log's maximum HP set inside the guess (round 69, T69). */
export const MEASURED_HP_SPREAD_DETAIL = 'HP read from the log, the rest kept from the guess';
/** Provenance details for items the move-order evidence decided (round 37). */
export const INFERRED_ITEM_DETAIL = 'moved first, Choice Scarf inferred';
export const RULED_OUT_ITEM_DETAIL = 'moved second, Choice Scarf ruled out';
/** The damage lines dropped a guessed boost item (round 69, T26). */
export const NO_BOOST_ITEM_DETAIL = 'damage rules out a boost item';
/** A knockout no spread of the set reaches, and a usage-listed boost item does (round 89, #75). */
export const KNOCKOUT_BOOST_ITEM_DETAIL = 'only a boost item reaches the knockout';

/** The detail of an item the solver decided, by its reason. */
export const ITEM_DETAIL = {
  'moved-first': INFERRED_ITEM_DETAIL, 'moved-second': RULED_OUT_ITEM_DETAIL, 'no-boost': NO_BOOST_ITEM_DETAIL, boost: KNOCKOUT_BOOST_ITEM_DETAIL,
} as const;

/** The detail of a solved spread, by who checked it. */
export const ORIGIN_DETAIL: Record<Exclude<SpreadOrigin, 'prior'>, string> = {
  damage: INFERRED_SPREAD_DETAIL, order: ORDER_SPREAD_DETAIL, hp: MEASURED_HP_SPREAD_DETAIL,
};
