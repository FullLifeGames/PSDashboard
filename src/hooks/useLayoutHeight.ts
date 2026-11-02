import { useCallback, useRef } from 'react';

const PROPERTY = '--ps-layout-h';

/**
 * Round 84 (turn dock), A7b (ruling 9a): the two columns of the workspace share one grid row that follows the left column's
 * content up to the layout's own height. The layout fills the window below the top bar (a flex item, so its height does not
 * depend on the columns); this hook writes that height onto the layout element as `--ps-layout-h`, and layout.css caps the left
 * column with it. A ResizeObserver follows the window; no React state. A height of 0 (no layout box yet) writes nothing, so the
 * stylesheet's fallback of 100% stays. A window without the observer (jsdom) gets the first measurement only.
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
