import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Round 84 (turn dock): which slot's tray is open, and when it closes. At most one tray is open. The state belongs to the viewed
 * position (a new `positionKey` closes it in the same render, the way `useArmedAt` drops the armed gimmicks). A click beside
 * the dock closes it; the replay is an iframe, whose clicks never reach this document, so the window losing focus to an iframe
 * closes it too. Escape closes it and returns the focus to the chip, except while the What-if box has its list open.
 */

type Side = 'p1' | 'p2';

export interface TrayOpen {
  side: Side;
  slot: number;
  /** The "Dice · What if" section is open. */
  more: boolean;
}

export const chipKey = (side: Side, slot: number): string => `${side}${slot}`;

export function useTrayState(positionKey: string | undefined) {
  const [state, setState] = useState<{ key: string | undefined; open: TrayOpen | null }>({ key: positionKey, open: null });
  const moved = state.key !== positionKey;
  if (moved) setState({ key: positionKey, open: null });
  const open = moved ? null : state.open;
  const root = useRef<HTMLElement | null>(null);
  // A callback ref: the hook hands out no ref object, so a component can read the hook's other values while it renders.
  const attachRoot = useCallback((element: HTMLElement | null) => { root.current = element; }, []);

  const close = useCallback((returnFocus = false) => {
    if (returnFocus && open) root.current?.querySelector<HTMLElement>(`[data-chip="${chipKey(open.side, open.slot)}"]`)?.focus();
    setState({ key: positionKey, open: null });
  }, [open, positionKey]);

  /** A chip opens its tray, switches to it from another slot's, or closes it when it is the open one. */
  const toggleChip = useCallback((side: Side, slot: number) => {
    setState({ key: positionKey, open: open?.side === side && open.slot === slot ? null : { side, slot, more: false } });
  }, [open, positionKey]);

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
