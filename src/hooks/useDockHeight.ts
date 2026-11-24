import { useCallback, useRef } from 'react';
import { appliedUiScale } from '../lib/ui-scale-store';

const PROPERTY = '--ps-dock-h';

/** Below 1050 px the dock is fixed at the bottom: its height goes to `--ps-dock-h`, divided by the root's zoom. */
export function useDockHeight(): (element: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const root = document.documentElement;
    if (!element) {
      root.style.removeProperty(PROPERTY);
      return;
    }
    const write = () => root.style.setProperty(PROPERTY, `${Math.ceil(element.getBoundingClientRect().height / appliedUiScale(root))}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(write);
    observer.current.observe(element);
  }, []);
}
