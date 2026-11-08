import { describe, expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import { generateReplayHtml } from '../../../src/lib/replay-html';
import { APP_CONTROLS_STYLES, sideTrackerScript } from '../../../src/lib/replay-controls';

/**
 * Round 88 (T316, #56): the workspace's replay frames hide the buttons the timeline covers (Last turn, Next turn, Go to turn...)
 * and the two choosers that do nothing in the app's frame (Color scheme, Music), and they report the side the frame shows near so
 * the dock can put that side's row on top. The embed rewrites row 1 on every battle update, so the hiding is CSS on `data-action`.
 */
const log = '|player|p1|A|1\n|player|p2|B|2\n|turn|1';

const scriptBodies = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

/** The tracker alone, in a document stand-in: the tests set `battle` and call `tick`. */
function runTracker(viewpoint: 'p1' | 'p2', replays?: unknown) {
  const posts: unknown[] = [];
  let tick: () => void = () => {};
  const sandbox: Record<string, unknown> = {
    setInterval: (fn: () => void) => { tick = fn; return 0; },
    parent: { postMessage: (message: unknown) => { posts.push(message); } },
  };
  if (replays !== undefined) sandbox.Replays = replays;
  runInNewContext(sideTrackerScript(true, viewpoint).replace(/<\/?script>/g, ''), sandbox);
  return { posts, tick: () => tick() };
}

const near = (sideid: string) => ({ battle: { nearSide: { sideid } } });

describe('the frame document that hides the turn controls', () => {
  test('hideTurnControls adds the style that hides rewind, ff, ffto and the two choosers, and nothing the app keeps', () => {
    const html = generateReplayHtml({ log, hideTurnControls: true });
    expect(html).toContain(APP_CONTROLS_STYLES);
    for (const hidden of ['rewind', 'ff', 'ffto']) expect(APP_CONTROLS_STYLES).toContain(`[data-action="${hidden}"]`);
    expect(APP_CONTROLS_STYLES).toContain('.colorchooser');
    expect(APP_CONTROLS_STYLES).toContain('.soundchooser');
    expect(APP_CONTROLS_STYLES).toContain('display:none !important');
    for (const kept of ['play', 'pause', 'reset', 'switchViewpoint']) expect(APP_CONTROLS_STYLES).not.toContain(`data-action="${kept}"`);
    expect(APP_CONTROLS_STYLES).not.toContain('speedchooser');
  });

  test('the default document holds no such style and no side tracker', () => {
    const html = generateReplayHtml({ log });
    expect(html).not.toContain(APP_CONTROLS_STYLES);
    expect(html).not.toContain('data-action="rewind"');
    expect(html).not.toContain('trackSide');
  });

  test('reportSide appends the tracker with the document\'s own viewpoint; without it there is none', () => {
    expect(scriptBodies(generateReplayHtml({ log, reportSide: true })).some(body => body.includes('trackSide'))).toBe(true);
    expect(generateReplayHtml({ log, reportSide: true, viewpoint: 'p2' })).toContain("var ownSide = 'p2';");
    expect(generateReplayHtml({ log, reportSide: true })).toContain("var ownSide = 'p1';");
    expect(generateReplayHtml({ log, hideTurnControls: true })).not.toContain('trackSide');
  });
});

describe('the side tracker', () => {
  test('a p1 document reports p1 on its first tick and a switch to p2; the same side again reports nothing', () => {
    const replays = { battle: { nearSide: { sideid: 'p1' } } };
    const { posts, tick } = runTracker('p1', replays);
    tick();
    tick();
    expect(posts).toEqual([{ type: 'ps-side', side: 'p1' }]);
    replays.battle.nearSide = { sideid: 'p2' };
    tick();
    tick();
    expect(posts).toEqual([{ type: 'ps-side', side: 'p1' }, { type: 'ps-side', side: 'p2' }]);
  });

  test('a p2 document stays silent while the embed still reads p1, then reports p2, then a switch back to p1', () => {
    const replays = { battle: { nearSide: { sideid: 'p1' } } };
    const { posts, tick } = runTracker('p2', replays);
    tick();
    tick();
    expect(posts).toEqual([]);
    replays.battle.nearSide = { sideid: 'p2' };
    tick();
    expect(posts).toEqual([{ type: 'ps-side', side: 'p2' }]);
    replays.battle.nearSide = { sideid: 'p1' };
    tick();
    expect(posts).toEqual([{ type: 'ps-side', side: 'p2' }, { type: 'ps-side', side: 'p1' }]);
  });

  test('no Replays, no battle or no nearSide: nothing posted and nothing thrown', () => {
    for (const replays of [undefined, {}, { battle: null }, { battle: {} }, { battle: { nearSide: {} } }]) {
      const { posts, tick } = runTracker('p1', replays);
      expect(() => tick()).not.toThrow();
      expect(posts).toEqual([]);
    }
  });

  test('a side that is neither p1 nor p2 reports nothing', () => {
    const { posts, tick } = runTracker('p1', near('p3'));
    tick();
    expect(posts).toEqual([]);
  });
});
