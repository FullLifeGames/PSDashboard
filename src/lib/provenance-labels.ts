import {
  INFERRED_ITEM_DETAIL, INFERRED_SPREAD_DETAIL, MEASURED_HP_SPREAD_DETAIL, ORDER_SPREAD_DETAIL, type KnowledgeSource,
} from '@fulllifegames/replay-core';

export function sourceAccent(source: KnowledgeSource): string {
  switch (source) {
    case 'revealed':
      return '#6cc2ff';
    case 'guessed':
      return '#f3c969';
    case 'manual':
      return '#78df9b';
    case 'sheet':
      return '#b48ef0';
    default:
      return '#8899aa';
  }
}

function formatProbability(probability: number | undefined): string {
  if (probability === undefined) return '';
  return `${Math.round(probability * 1000) / 10}%`;
}

export function sourceLabel(source: KnowledgeSource, probability?: number, sourceDetail?: string): string {
  switch (source) {
    case 'revealed':
      return 'revealed';
    case 'guessed':
      // A spread solved from observed damage is a fit, not a usage guess; an item the move order proved: an inference.
      if (sourceDetail === INFERRED_SPREAD_DETAIL) return 'fitted';
      if (sourceDetail === ORDER_SPREAD_DETAIL) return 'from move order';
      if (sourceDetail === MEASURED_HP_SPREAD_DETAIL) return 'HP from log';
      if (sourceDetail === INFERRED_ITEM_DETAIL) return 'inferred';
      return probability === undefined ? 'guessed' : `guessed ${formatProbability(probability)}`;
    case 'manual':
      return 'manual';
    case 'sheet':
      return 'sheet';
    default:
      return 'unknown';
  }
}
