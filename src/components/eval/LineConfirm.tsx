import { useEffect, useRef } from 'react';
import { ConfirmBanner } from '../ConfirmBanner';
import type { LineConfirm as LineConfirmData } from '../../lib/line-view';

/** Sits in the block of the click and scrolls itself into view: the dock's banner can be out of sight there. */
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
