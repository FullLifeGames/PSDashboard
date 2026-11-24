import { followContentHeight } from './replay-frame-height';
import { followFrameZoom } from './replay-frame-zoom';

/** Zoom first (it decides the layout width), then the phone-mode height; one disposer. */
export function followFrame(frame: HTMLIFrameElement): () => void {
  const stops = [followFrameZoom(frame), followContentHeight(frame)];
  return () => stops.forEach(stop => stop());
}
