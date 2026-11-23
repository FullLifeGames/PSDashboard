import { useEffect, useRef } from 'react';
import { ConfirmBanner } from '../ConfirmBanner';
import type { LineConfirm as LineConfirmData } from '../../lib/line-view';

/**
 * The replace question after ▶ Play, under the line that was clicked: the dock's banner stands 800 px above the screen at phone width and
 * under the dock bar with the history open, so this one sits in the block of the click and scrolls itself into the upper part of the
 * screen when it opens elsewhere.
 */
export function LineConfirm({ confirm }: { confirm: LineConfirmData }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || (box.top >= 0 && box.bottom <= window.innerHeight * 0.6)) return;
    ref.current?.scrollIntoView?.({ block: 'center' });
  }, []);
  return (
    <div ref={ref}>
      <ConfirmBanner message={confirm.message} onProceed={confirm.proceed} onCancel={confirm.cancel} />
    </div>
  );
}
