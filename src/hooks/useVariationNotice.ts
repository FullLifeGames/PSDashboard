import { useCallback, useState } from 'react';
import type { Timeline } from './useTimeline';

type NoticeTimeline = Pick<Timeline, 'viewTurn' | 'viewLine' | 'setVariationScores' | 'setViewLine' | 'setViewTurn'>;

/**
 * A notice about the variation that went away or came back (round 77): a refused execute that restored the old
 * variation or left none behind, or a rebuild that kept no turn. It belongs to the position where it appeared and
 * leaves once the pointer moves on or a turn is played. The position is read on the first render after the notice;
 * a render-phase reconciliation, no effect.
 */
export function useVariationNotice(timeline: NoticeTimeline, historyLength: number, snapshotCount: number) {
  const [notice, setNotice] = useState<{ text: string; key: string | null } | null>(null);
  const positionKey = `${timeline.viewTurn}:${timeline.viewLine}:${historyLength}`;
  if (notice) {
    if (notice.key === null) setNotice({ ...notice, key: positionKey });
    else if (notice.key !== positionKey) setNotice(null);
  }
  const setVariationNotice = useCallback((text: string | null) => setNotice(text === null ? null : { text, key: null }), []);

  const maxTurn = snapshotCount > 0 ? snapshotCount : 1;
  const { setVariationScores, setViewLine, setViewTurn } = timeline;
  /** A rebuild that kept no turn: no variation is left, the pointer stays on the main line at its turn. */
  const reportVariationEnded = useCallback((text: string) => {
    setVariationNotice(text);
    setVariationScores([]);
    setViewLine('main');
    setViewTurn(current => Math.min(current, maxTurn));
  }, [setVariationNotice, setVariationScores, setViewLine, setViewTurn, maxTurn]);

  return { variationNotice: notice?.text ?? null, setVariationNotice, reportVariationEnded };
}
