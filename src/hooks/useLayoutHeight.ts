import { useCallback, useRef } from 'react';

const PROPERTY = '--ps-layout-h';

/**
 * The two columns of the workspace share one grid row that follows the left column's content up to the layout's own height: this hook
 * writes the layout element's height (a flex item below the top bar) as `--ps-layout-h`, and layout.css caps the left column with it.
 * A height of 0 (no layout box yet) writes nothing, so the stylesheet's fallback of 100% stays. A window without a ResizeObserver
 * (jsdom) gets the first measurement only.
 */
export function useLayoutHeight(): (element: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const write = () => {
      const height = element.clientHeight;
      if (height > 0) element.style.setProperty(PROPERTY, `${height}px`);
      else element.style.removeProperty(PROPERTY);
    };
    write();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(write);
    observer.current.observe(element);
  }, []);
}
