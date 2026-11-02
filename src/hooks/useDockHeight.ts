import { useCallback, useRef } from 'react';

const PROPERTY = '--ps-dock-h';

/**
 * Round 84 (turn dock): below 1050 px the dock is fixed at the viewport's lower edge, so the page pads by its height and the
 * tray stands on top of it (dock.css reads `--ps-dock-h`). The height goes to the root element as a CSS custom property, written
 * from a ResizeObserver; no React state, so a change of the dock's size repaints nothing but the style. Returns a callback ref for
 * the dock's element; the property goes when the dock does. A window without the observer (jsdom) gets the first measurement only.
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
    const write = () => root.style.setProperty(PROPERTY, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(write);
    observer.current.observe(element);
  }, []);
}
