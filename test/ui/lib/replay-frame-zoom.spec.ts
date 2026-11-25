import { afterEach, describe, expect, test } from 'vitest';
import { followFrameZoom } from '../../../src/lib/replay-frame-zoom';
import { UI_SCALE_EVENT } from '../../../src/lib/ui-scale-store';

// Chromium zooms the frame's content with the page (layout width 400 of 400 at 150 %); WebKit 27.2 gives the frame the
// physical width (600 of 400) and renders at 100 %.
afterEach(() => { document.body.innerHTML = ''; });

function frame(outer: number, width: (zoom: number) => number) {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const root = iframe.contentDocument!.documentElement;
  Object.defineProperty(iframe, 'clientWidth', { configurable: true, value: outer });
  Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width(Number(root.style.zoom) || 1) });
  return { iframe, root };
}

const chromium = (outer: number) => () => outer;
const webkit = (outer: number, scale: number) => (zoom: number) => (outer * scale) / zoom;

describe('followFrameZoom', () => {
  test('an engine that carries the zoom into the frame (Chromium) gets none', () => {
    const { iframe, root } = frame(400, chromium(400));
    followFrameZoom(iframe);
    expect(root.style.zoom).toBe('');
  });

  test.each([1.25, 1.5, 1.75, 2])('an engine that lays the frame out at the physical width (WebKit) zooms the document by %f', scale => {
    const { iframe, root } = frame(400, webkit(400, scale));
    followFrameZoom(iframe);
    expect(Number(root.style.zoom)).toBeCloseTo(scale, 6);
    expect(root.clientWidth).toBeCloseTo(400, 6);
  });

  test('a round-off of a pixel does not zoom: 401 of 400 is the same layout', () => {
    const { iframe, root } = frame(400, chromium(401));
    followFrameZoom(iframe);
    expect(root.style.zoom).toBe('');
  });

  test('a new factor refits the frame: the event of the store, and the page\'s resize, measure again without the old zoom', () => {
    let scale = 1.5;
    const { iframe, root } = frame(400, (zoom) => (400 * scale) / zoom);
    followFrameZoom(iframe);
    expect(Number(root.style.zoom)).toBeCloseTo(1.5, 6);
    scale = 2;
    window.dispatchEvent(new Event(UI_SCALE_EVENT));
    expect(Number(root.style.zoom)).toBeCloseTo(2, 6);
    scale = 1;
    window.dispatchEvent(new Event('resize'));
    expect(root.style.zoom).toBe('');
  });

  test('the same state fits to the same zoom however often it runs (no flapping)', () => {
    const { iframe, root } = frame(400, webkit(400, 1.5));
    followFrameZoom(iframe);
    const first = root.style.zoom;
    for (let i = 0; i < 4; i++) window.dispatchEvent(new Event(UI_SCALE_EVENT));
    expect(root.style.zoom).toBe(first);
  });

  test('the disposer stops following and takes the zoom away', () => {
    const { iframe, root } = frame(400, webkit(400, 1.5));
    const stop = followFrameZoom(iframe);
    stop();
    expect(root.style.zoom).toBe('');
    window.dispatchEvent(new Event(UI_SCALE_EVENT));
    expect(root.style.zoom).toBe('');
  });

  test('a frame with no width yet, or without a document, is left alone', () => {
    const empty = frame(0, chromium(0));
    followFrameZoom(empty.iframe);
    expect(empty.root.style.zoom).toBe('');
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', { get: () => null });
    expect(() => followFrameZoom(iframe)()).not.toThrow();
  });
});
