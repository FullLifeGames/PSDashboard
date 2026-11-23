import { followContentHeight } from './replay-frame-height';
import { followFrameZoom } from './replay-frame-zoom';

/** Follows a loaded replay frame: the zoom first (it decides the layout width), then the phone-mode height. Returns one disposer. */
export function followFrame(frame: HTMLIFrameElement): () => void {
  const stops = [followFrameZoom(frame), followContentHeight(frame)];
  return () => stops.forEach(stop => stop());
}
