import { UI_SCALE_EVENT } from './ui-scale-store';

/**
 * Round 84 (T315, A7d): the replay frame under the root's zoom. The zoom probe of A7c found the engines apart. Chromium carries the
 * zoom into a same-origin frame (inside it the layout width is the frame's CSS width and the pixel ratio is the zoom's), so nothing
 * is left to do. WebKit 27.2 lays the frame's document out at the physical width (600 for a frame of 400 CSS px at 150 %) and draws
 * the content at 100 %: the replay would stand small in a frame that grew. This follower compares the document's layout width with
 * the frame's CSS width, and when the document is wider zooms its root by the ratio, so the replay fills the frame at the zoomed
 * size (a browser zoom redraws the text at full resolution, no bitmap is stretched) and is never scaled twice: where the two widths
 * agree, nothing is set.
 *
 * It measures with its own zoom taken off, so the result is the same however often it runs, and refits on a new factor of the
 * store, on the page's resize and on the frame's own resize. The three paths all end at the same state; none sets a state of React.
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
