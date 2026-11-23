import { PHONE_CLASS } from './replay-phone';

/** The iframe property that holds the frame's height in phone mode; the frame's style falls back to REPLAY_FRAME_HEIGHT. */
export const FRAME_HEIGHT_PROPERTY = '--ps-frame-h';

/**
 * Follows the content height of a same-origin replay document in phone mode into the iframe's property, and gives it back on the
 * desktop layout. Writes the style directly, no React state. Returns the disposer.
 *
 * Three rules keep it out of a ResizeObserver loop ("loop completed with undelivered notifications"): it observes with the frame
 * document's own `contentWindow.ResizeObserver`; it measures the body's box, not the root's `scrollHeight` (never below the
 * viewport, so it reads back the box it sized); it writes only when the height changed.
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
