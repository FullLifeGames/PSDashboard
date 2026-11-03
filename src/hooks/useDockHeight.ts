import { useCallback, useRef } from 'react';
import { appliedUiScale } from '../lib/ui-scale-store';

const PROPERTY = '--ps-dock-h';

/**
 * Round 84 (turn dock): below 1050 px the dock is fixed at the viewport's lower edge, so the page pads by its height and the
 * tray stands on top of it (dock.css reads `--ps-dock-h`). The height goes to the root element as a CSS custom property, written
 * from a ResizeObserver; no React state, so a change of the dock's size repaints nothing but the style. Returns a callback ref for
 * the dock's element; the property goes when the dock does. Round 84 (T315, A7d): under the root's zoom the rect is in visual pixels while the property is a
 * CSS length inside the zoomed tree, so the height is divided by the factor the root carries. A window without the observer (jsdom) gets the first measurement only.
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
