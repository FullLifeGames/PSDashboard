import { PHONE_CLASS } from './replay-phone';

export const FRAME_HEIGHT_PROPERTY = '--ps-frame-h';

/** Follows the content height of a same-origin replay in phone mode into the iframe's property. */
// Avoids a ResizeObserver loop: the frame's own observer, the body's box (not scrollHeight), writes on change.
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
