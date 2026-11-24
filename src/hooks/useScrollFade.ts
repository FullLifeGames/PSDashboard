import { useCallback, useRef } from 'react';

/** A scrolling list fades over its last 36 px while more follows (`data-more="true"`, read by stats-panel.css). */
export function useScrollFade(): (element: HTMLElement | null) => void {
  const release = useRef<(() => void) | null>(null);
  return useCallback((element: HTMLElement | null) => {
    release.current?.();
    release.current = null;
    if (!element) return;
    const update = () => {
      const more = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      if (more) element.setAttribute('data-more', 'true');
      else element.removeAttribute('data-more');
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(element);
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    mutation?.observe(element, { childList: true, subtree: true, characterData: true });
    release.current = () => {
      element.removeEventListener('scroll', update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, []);
}
