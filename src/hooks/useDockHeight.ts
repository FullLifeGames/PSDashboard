import { useCallback, useRef } from 'react';
import { appliedUiScale } from '../lib/ui-scale-store';

const PROPERTY = '--ps-dock-h';

/**
 * Below 1050 px the dock is fixed at the viewport's lower edge: its height goes to the root element as `--ps-dock-h` (dock.css pads
 * the page and the tray with it), written from a ResizeObserver with no React state and removed with the dock. Under the root's zoom
 * the height is divided by the zoom factor; a window without the observer (jsdom) gets the first measurement only.
 */
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
