import { describe, expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import { generateReplayHtml } from '../../../src/lib/replay-html';
import {
  PHONE_BATTLE, PHONE_BREAKPOINT, PHONE_CLASS, PHONE_FIT_SCRIPT, PHONE_SCALE_PROPERTY, PHONE_STYLES,
} from '../../../src/lib/replay-phone';

/**
 * Round 84 (T315, A7c, ruling 10a): on a phone the replay's battle scene shrinks to the frame's width, and the controls and the
 * log stand under it at their own size. The document decides by its own width: below the battle's 642 px it takes the class
 * `ps-phone` and the scale `--ps-k`; the stylesheet turns the embed's absolute layout into one column.
 */
const log = '|player|p1|A|1\n|player|p2|B|2\n|turn|1';

/** The fit script in a minimal document: a root element with a class list, a style map and a width. */
function runFit(width: number) {
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const listeners: Record<string, () => void> = {};
  const root = {
    clientWidth: width,
    classList: { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); } },
    style: { setProperty: (name: string, value: string) => { props.set(name, value); } },
  };
  const sandbox = {
    document: { documentElement: root },
    window: { addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; } },
  };
  runInNewContext(PHONE_FIT_SCRIPT.replace(/<\/?script>/g, ''), sandbox);
  return { root, classes, props, resize: (next: number) => { root.clientWidth = next; listeners.resize(); } };
}

describe('the phone document', () => {
  test('the constants name the embed\'s battle: 640 x 360 and a 1 px border', () => {
    expect(PHONE_BATTLE).toEqual({ width: 642, height: 362 });
    expect(PHONE_BREAKPOINT).toBe(642);
  });

  test('a frame of 390 px takes the phone class and the scale 390 / 642', () => {
    const { classes, props } = runFit(390);
    expect(classes.has(PHONE_CLASS)).toBe(true);
    expect(Number(props.get(PHONE_SCALE_PROPERTY))).toBeCloseTo(390 / 642, 6);
  });

  test('a frame as wide as the battle or wider keeps the desktop layout at scale 1', () => {
    for (const width of [642, 900, 1366]) {
      const { classes, props } = runFit(width);
      expect(classes.has(PHONE_CLASS), `${width} px`).toBe(false);
      expect(props.get(PHONE_SCALE_PROPERTY)).toBe('1');
    }
  });

  test('the edge: 641 px is a phone frame, 642 px is not', () => {
    expect(runFit(641).classes.has(PHONE_CLASS)).toBe(true);
    expect(runFit(642).classes.has(PHONE_CLASS)).toBe(false);
  });

  test('a resize moves the frame between the two layouts, both ways', () => {
    const run = runFit(900);
    run.resize(360);
    expect(run.classes.has(PHONE_CLASS)).toBe(true);
    expect(Number(run.props.get(PHONE_SCALE_PROPERTY))).toBeCloseTo(360 / 642, 6);
    run.resize(1000);
    expect(run.classes.has(PHONE_CLASS)).toBe(false);
    expect(run.props.get(PHONE_SCALE_PROPERTY)).toBe('1');
  });

  test('a frame with no width yet (not laid out) stays on the desktop layout', () => {
    expect(runFit(0).classes.has(PHONE_CLASS)).toBe(false);
  });
});

describe('the phone stylesheet', () => {
  const rules = PHONE_STYLES;

  test('only the phone class changes the layout', () => {
    for (const line of rules.split('\n').filter(entry => entry.includes('{'))) expect(line.startsWith(`html.${PHONE_CLASS} `)).toBe(true);
  });

  test('the scene is scaled by the document\'s factor from its top left corner, and its height follows', () => {
    expect(rules).toContain(`transform:scale(var(${PHONE_SCALE_PROPERTY},1))`);
    expect(rules).toContain('transform-origin:0 0');
    expect(rules).toContain(`margin-bottom:calc((var(${PHONE_SCALE_PROPERTY},1) - 1) * 362px)`);
    expect(rules).toMatch(/\.battle\{position:relative;top:0;left:0;/);
  });

  test('the wrapper stacks the scene, the controls, the speed row and the log in one column at their own size', () => {
    expect(rules).toMatch(/\.wrapper\.replay-wrapper\{display:flex;flex-direction:column;padding-top:0 !important;margin-top:0;\}/);
    expect(rules).toMatch(/\.replay-controls\{order:1;\}/);
    expect(rules).toMatch(/\.replay-controls-2\{order:2;\}/);
    expect(rules).toMatch(/\.battle-log\{position:static;order:3;[^}]*width:auto;height:360px;/);
    expect(rules).toMatch(/\.replay-controls,html\.ps-phone \.replay-controls-2\{position:static;/);
  });
});

describe('the generated document', () => {
  test('carries the stylesheet and the fit script before the embed loads, so the scene never shows at 640 px first', () => {
    const html = generateReplayHtml({ log });
    expect(html).toContain(PHONE_STYLES);
    expect(html).toContain(PHONE_FIT_SCRIPT);
    expect(html.indexOf(PHONE_STYLES)).toBeLessThan(html.indexOf('replay-embed.js'));
    expect(html.indexOf(PHONE_FIT_SCRIPT)).toBeLessThan(html.indexOf('replay-embed.js'));
  });

  test('keeps the route table of the embed (the scripts load in no fixed order)', () => {
    expect(generateReplayHtml({ log })).toContain("routes: {root: 'pokemonshowdown.com', client: 'play.pokemonshowdown.com'");
  });
});
