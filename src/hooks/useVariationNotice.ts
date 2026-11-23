import { useCallback, useState } from 'react';
import type { Timeline } from './useTimeline';

type NoticeTimeline = Pick<Timeline, 'viewTurn' | 'viewLine' | 'setVariationScores' | 'setViewLine' | 'setViewTurn'>;

/**
 * A notice about the variation that went away or came back: a refused execute that restored the old variation or left none behind,
 * or a rebuild that kept no turn. It belongs to the position where it appeared and leaves once the pointer moves on or a turn is
 * played. A render-phase reconciliation reads the position on the first render after the notice, no effect.
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
  const reportVariationEnded = useCallback((text: string) => {
    setVariationNotice(text);
    setVariationScores([]);
    setViewLine('main');
    setViewTurn(current => Math.min(current, maxTurn));
  }, [setVariationNotice, setVariationScores, setViewLine, setViewTurn, maxTurn]);

  return { variationNotice: notice?.text ?? null, setVariationNotice, reportVariationEnded };
}
