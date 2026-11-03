import { PHONE_CLASS } from './replay-phone';

/**
 * Round 84 (T315, A7c, ruling 10a): the property on the iframe element that holds the frame's height in phone mode. The frame's
 * style reads it with REPLAY_FRAME_HEIGHT as the fallback, so the desktop layout needs no write at all.
 */
export const FRAME_HEIGHT_PROPERTY = '--ps-frame-h';

/**
 * Follows the content height of a same-origin replay document while it stands in phone mode (the scene, the controls and the log in
 * one column): the iframe's property takes the document's height on every change of its size or class, and gives it back when the
 * document returns to the desktop layout. Writes the element's style directly, no React state. Returns the disposer.
 *
 * Round 84 (A7d): three rules keep it out of a ResizeObserver loop (the A7c run raised "loop completed with undelivered
 * notifications" 15 times in 19 tests). The observer is the frame document's own (`contentWindow.ResizeObserver`), so a page
 * observer never sees a body of another document, and the frame's own loop stays in the frame. It measures the body's box, the
 * content, and not the root's `scrollHeight`, which never falls below the viewport and so reads back the box it sized. And it
 * writes only when the height changed; the desktop layout writes nothing at all.
 */
export function followContentHeight(iframe: HTMLIFrameElement): () => void {
  const doc = iframe.contentDocument;
  const root = doc?.documentElement;
  if (!doc || !root) return () => {};
  const body = doc.body ?? root;
  let written = '';
  const write = () => {
    const next = root.classList.contains(PHONE_CLASS) ? `${Math.ceil(body.offsetHeight)}px` : '';
    if (next === written) return;
    written = next;
    if (next) iframe.style.setProperty(FRAME_HEIGHT_PROPERTY, next);
    else iframe.style.removeProperty(FRAME_HEIGHT_PROPERTY);
  };
  const Observer = (iframe.contentWindow as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver;
  const resize = Observer ? new Observer(write) : null;
  resize?.observe(body);
  const mutation = new MutationObserver(write);
  mutation.observe(root, { attributes: true, attributeFilter: ['class'] });
  write();
  return () => {
    resize?.disconnect();
    mutation.disconnect();
    written = '';
    iframe.style.removeProperty(FRAME_HEIGHT_PROPERTY);
  };
}
