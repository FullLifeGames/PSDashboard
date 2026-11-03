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
 */
export function followContentHeight(iframe: HTMLIFrameElement): () => void {
  const doc = iframe.contentDocument;
  const root = doc?.documentElement;
  if (!doc || !root) return () => {};
  const write = () => {
    if (root.classList.contains(PHONE_CLASS)) iframe.style.setProperty(FRAME_HEIGHT_PROPERTY, `${Math.ceil(root.scrollHeight)}px`);
    else iframe.style.removeProperty(FRAME_HEIGHT_PROPERTY);
  };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
  resize?.observe(doc.body ?? root);
  const mutation = new MutationObserver(write);
  mutation.observe(root, { attributes: true, attributeFilter: ['class'] });
  write();
  return () => {
    resize?.disconnect();
    mutation.disconnect();
    iframe.style.removeProperty(FRAME_HEIGHT_PROPERTY);
  };
}
