import { followContentHeight } from './replay-frame-height';
import { followFrameZoom } from './replay-frame-zoom';

/**
 * Round 84 (T315, A7d): what a loaded replay frame follows, in the order that matters: the zoom first (it decides the document's
 * layout width), then the height that follows the document's content in phone mode. Returns one disposer for both.
 */
export function followFrame(frame: HTMLIFrameElement): () => void {
  const stops = [followFrameZoom(frame), followContentHeight(frame)];
  return () => stops.forEach(stop => stop());
}
