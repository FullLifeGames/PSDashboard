import { useCallback, useRef } from 'react';

/**
 * Round 84 (turn dock), A7b (ruling 9a): a list that scrolls inside its panel fades out over its last 36 px while more follows
 * (stats-panel.css reads `data-more="true"`). The mark goes onto the element from its scroll position, a ResizeObserver (the panel
 * or the window changed) and a MutationObserver (the content changed); no React state, so a scroll repaints nothing but the mask.
 * The list at its end, or one that fits, carries no mark. Returns a callback ref; the listeners go with the element.
 */
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
