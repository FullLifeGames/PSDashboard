import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

// `onLeave` reports the slot a tray leaves, from the event that does it, so the engine's deferred pick lands then;
// a new `positionKey` closes the tray in the same render and reports nothing: the pick belonged to the old position.

type Side = 'p1' | 'p2';

export interface TrayOpen {
  side: Side;
  slot: number;
  more: boolean;
}

export const chipKey = (side: Side, slot: number): string => `${side}${slot}`;

export function useTrayState(positionKey: string | undefined, onLeave?: (left: TrayOpen) => void) {
  const [state, setState] = useState<{ key: string | undefined; open: TrayOpen | null }>({ key: positionKey, open: null });
  const moved = state.key !== positionKey;
  if (moved) setState({ key: positionKey, open: null });
  const open = moved ? null : state.open;
  const root = useRef<HTMLElement | null>(null);
  const attachRoot = useCallback((element: HTMLElement | null) => { root.current = element; }, []);

  const close = useCallback((returnFocus = false) => {
    if (returnFocus && open) root.current?.querySelector<HTMLElement>(`[data-chip="${chipKey(open.side, open.slot)}"]`)?.focus();
    if (open) onLeave?.(open);
    setState({ key: positionKey, open: null });
  }, [open, positionKey, onLeave]);

  const toggleChip = useCallback((side: Side, slot: number) => {
    if (open) onLeave?.(open);
    setState({ key: positionKey, open: open?.side === side && open.slot === slot ? null : { side, slot, more: false } });
  }, [open, positionKey, onLeave]);

  const toggleMore = useCallback(() => {
    setState({ key: positionKey, open: open ? { ...open, more: !open.more } : null });
  }, [open, positionKey]);

  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const onBlur = () => {
      if (document.activeElement?.tagName === 'IFRAME') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [isOpen, close]);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    // The What-if box closes its own list on Escape and leaves the event alone.
    if (event.target instanceof Element && event.target.getAttribute('aria-expanded') === 'true' && event.target.getAttribute('role') === 'combobox') return;
    close(true);
  }, [open, close]);


  return { open, attachRoot, close, toggleChip, toggleMore, onKeyDown };
}
