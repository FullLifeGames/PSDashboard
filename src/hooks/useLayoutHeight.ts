import { useCallback, useRef } from 'react';

const PROPERTY = '--ps-layout-h';

/** Writes the layout element's height as `--ps-layout-h`, which layout.css caps the left column with; 0 writes none. */
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
