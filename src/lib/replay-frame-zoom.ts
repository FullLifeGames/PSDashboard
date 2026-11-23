import { UI_SCALE_EVENT } from './ui-scale-store';

/**
 * Fits the replay frame under the root's zoom: where the document's layout width exceeds the frame's CSS width, zooms its root by
 * the ratio. Chromium carries the zoom into a same-origin frame (nothing to do); WebKit lays the frame out at the physical width
 * and draws at 100 %. It measures with its own zoom taken off, so the result does not depend on how often it runs.
 */

/** A layout width within this factor of the frame's CSS width is the same layout (a rounded pixel), not a zoom. */
const SAME_LAYOUT = 1.02;

export function followFrameZoom(iframe: HTMLIFrameElement): () => void {
  const doc = iframe.contentDocument;
  const root = doc?.documentElement;
  const win = iframe.contentWindow;
  if (!doc || !root) return () => {};
  const fit = () => {
    root.style.removeProperty('zoom');
    const layout = root.clientWidth;
    const frame = iframe.clientWidth;
    if (layout > 0 && frame > 0 && layout / frame > SAME_LAYOUT) root.style.setProperty('zoom', String(layout / frame));
  };
  window.addEventListener(UI_SCALE_EVENT, fit);
  window.addEventListener('resize', fit);
  win?.addEventListener?.('resize', fit);
  fit();
  return () => {
    window.removeEventListener(UI_SCALE_EVENT, fit);
    window.removeEventListener('resize', fit);
    win?.removeEventListener?.('resize', fit);
    root.style.removeProperty('zoom');
  };
}
