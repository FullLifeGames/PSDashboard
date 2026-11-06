import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { TYPE_BG, contrastRatio, typeTileVars } from '../../src/lib/type-colors';

/**
 * Round 83, the user's report of 01.11.2026: the KO note "(guaranteed ... recovery)" of a move tile was always yellow and not
 * always visible, and white text on the light type colors looked soft. The design gate of the same day chose tinted tiles: the
 * type color mixed deep into the navy, the full type color on the top line, the type badge and the selection ring. Every text
 * of a move tile and a switch chip reads at 4.5 : 1 or more (WCAG AA for small text) on every type color the tiles show; the
 * tiles before read 1.5 : 1 (white on Electric) and 1.15 : 1 (the yellow KO note on Electric). The fixed colors come from
 * pickers.css, the type colors from typeTileVars.
 *
 * Round 84 (turn dock), A6a: the dock's own colors in dock.css are held to the same bar: the chip, the type tag, the selected
 * tile, target and switch, the flags, the legend and the strip. The selection blue (white text read 2.5 : 1 on the .ps-btn
 * gradient, the integrator's look check of 02.11.2026) is darker in the dock. Execute is not in this list: round 87 (release 1.1.0,
 * T313) holds it, with .ps-btn, .ps-btn-red and the loader's guide steps, in button-contrast.spec.ts.
 */
const read = (file: string): string => readFileSync(new URL(`../../src/styles/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = read('pickers.css');
const dockCss = read('dock.css');
const baseCss = read('base.css');

const tokenIn = (source: string, file: string, name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(source);
  if (!match) throw new Error(`${file} declares no --${name}`);
  return match[1];
};
const token = (name: string): string => tokenIn(css, 'pickers.css', name);

const AA = 4.5;

describe('every text of a move tile reads on every type color', () => {
  test.each(Object.keys(TYPE_BG))('%s', type => {
    const vars = typeTileVars(type);
    // the tint is lightest at the top of its gradient
    for (const name of ['ps-tile-text', 'ps-tile-sub', 'ps-tile-dmg', 'ps-tile-ko']) {
      expect(contrastRatio(token(name), vars['--tint']), `${name} on the ${type} tint`).toBeGreaterThanOrEqual(AA);
    }
    expect(contrastRatio(vars['--type-on'], vars['--type']), `the ${type} badge`).toBeGreaterThanOrEqual(AA);
  });
});

test('the badges and the switch chips read on their own faces', () => {
  expect(contrastRatio(token('ps-badge-forced-fg'), token('ps-badge-forced-bg'))).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(token('ps-badge-played-fg'), token('ps-badge-played-bg'))).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(token('ps-switch-text'), token('ps-switch-bg'))).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(token('ps-switch-sub'), token('ps-switch-bg'))).toBeGreaterThanOrEqual(AA);
});

test('the contrast ratio follows WCAG: white on black is 21, a color on itself 1', () => {
  expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  expect(contrastRatio('#F8D030', '#F8D030')).toBeCloseTo(1, 5);
  expect(contrastRatio('#ffffff', '#F8D030')).toBeLessThan(AA);
});

/** The declarations of the rule in dock.css whose selector list starts with `selector`. */
const ruleOf = (selector: string): string => {
  const start = dockCss.indexOf(`\n${selector}`);
  if (start < 0) throw new Error(`dock.css has no rule starting ${selector}`);
  const open = dockCss.indexOf('{', start);
  return dockCss.slice(open + 1, dockCss.indexOf('}', open));
};

/** The two hex stops of a rule's `background: linear-gradient(180deg, #top 0%, #bottom 100%)`. */
function stopsOf(selector: string): [string, string] {
  const match = /linear-gradient\(180deg,\s*(#[0-9a-fA-F]{6}) 0%,\s*(#[0-9a-fA-F]{6}) 100%\)/.exec(ruleOf(selector));
  if (!match) throw new Error(`${selector} has no two-stop hex gradient`);
  return [match[1], match[2]];
}

const hex = (value: number): string => Math.round(value).toString(16).padStart(2, '0');

/** An `rgba(r, g, b, a)` color laid over an opaque hex color. */
function over(rgba: string, base: string): string {
  const match = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba);
  if (!match) throw new Error(`not an rgba color: ${rgba}`);
  const alpha = Number(match[4]);
  const channels = [1, 3, 5].map(index => parseInt(base.slice(index, index + 2), 16));
  return `#${[0, 1, 2].map(index => hex(Number(match[index + 1]) * alpha + channels[index] * (1 - alpha))).join('')}`;
}

/** The `rgba(...)` of the first stop of a gradient declared in a rule. */
const firstRgba = (selector: string): string => {
  const match = /linear-gradient\(180deg,\s*(rgba\([^)]*\))/.exec(ruleOf(selector));
  if (!match) throw new Error(`${selector} has no rgba gradient`);
  return match[1];
};

describe('the dock: the selection blue', () => {
  const SELECTED = ['.ps-movebtn-selected,', '.ps-target-btn-selected,', '.ps-dock .ps-switchbtn-selected {', '.ps-dock-label {', '.ps-tray-btn[aria-expanded="true"] {'];
  const [top, bottom] = stopsOf('.ps-movebtn-selected,');

  test('the four selected parts and the slot label share one gradient', () => {
    for (const selector of SELECTED) expect(stopsOf(selector), selector).toEqual([top, bottom]);
  });

  test('white text reads on the lightest stop of the selection gradient', () => {
    expect(contrastRatio('#ffffff', top)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio('#ffffff', bottom)).toBeGreaterThanOrEqual(AA);
  });

  test('every text of a selected move tile reads on it', () => {
    for (const name of ['ps-tile-text', 'ps-tile-sub', 'ps-tile-dmg', 'ps-tile-ko']) {
      expect(contrastRatio(token(name), top), name).toBeGreaterThanOrEqual(AA);
    }
  });

  test('a selected target button reads: its name, slot, HP and meta line', () => {
    expect(contrastRatio('#f5f5f5', top)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio('#ffffff', top)).toBeGreaterThanOrEqual(AA);
  });

  test('a selected switch tile reads: its name and its HP', () => {
    expect(contrastRatio(token('ps-switch-text'), top)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio('#ffffff', top)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the dock: the chip, the tray and the strip', () => {
  const barTop = stopsOf('.ps-dock-bar {')[0];
  const trayTop = stopsOf('.ps-tray {')[0];
  const chipTop = over(firstRgba('.ps-dock-chip {'), barTop);

  test('the chip reads: its pick, the body line, the empty pick line and the shimmer over it', () => {
    expect(contrastRatio(token('ps-tile-text'), chipTop), 'pick').toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(token('ps-switch-sub'), chipTop), 'body and HP').toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(token('ps-tile-sub'), chipTop), 'empty pick').toBeGreaterThanOrEqual(AA);
    const shimmer = over('rgba(255, 255, 255, 0.14)', chipTop);
    expect(contrastRatio(token('ps-tile-sub'), shimmer), 'empty pick in the shimmer').toBeGreaterThanOrEqual(AA);
  });

  test('the type tag takes its colors from the tile variables the type test holds', () => {
    const tag = ruleOf('.ps-type-tag {');
    expect(tag).toMatch(/background:\s*var\(--type\b/);
    expect(tag).toMatch(/color:\s*var\(--type-on\b/);
  });

  test('the flags on a tile are the played and forced badges, which read on their faces', () => {
    expect(dockCss).toMatch(/\.ps-tile-flags \.ps-played-badge,\n\.ps-tile-flags \.ps-forced-badge/);
    expect(contrastRatio(token('ps-badge-played-fg'), token('ps-badge-played-bg'))).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(token('ps-badge-forced-fg'), token('ps-badge-forced-bg'))).toBeGreaterThanOrEqual(AA);
  });

  test('the legend, the tray labels and the dice captions read on the tray', () => {
    expect(ruleOf('.ps-tile-legend {')).toMatch(/color:\s*var\(--ps-switch-sub\)/);
    expect(contrastRatio(token('ps-switch-sub'), trayTop), 'legend, HP, labels and hint').toBeGreaterThanOrEqual(AA);
    expect(ruleOf('.ps-dice-table .ps-dice-caption {')).toMatch(/color:\s*var\(--ps-muted\)/);
    expect(contrastRatio(tokenIn(baseCss, 'base.css', 'ps-muted'), trayTop), 'dice captions').toBeGreaterThanOrEqual(AA);
  });

  test('the target buttons read: name, slot, HP and meta line', () => {
    // the button darkens the tray behind it, so the tray's lightest stop is the worst case
    for (const color of ['#f5f5f5', '#a9d7ff', '#c9d4e6']) expect(contrastRatio(color, trayTop), color).toBeGreaterThanOrEqual(AA);
  });

  test('the status strip reads on the page\'s deep navy', () => {
    expect(ruleOf('.ps-dock-status {')).toMatch(/color:\s*var\(--ps-muted\)/);
    expect(contrastRatio(tokenIn(baseCss, 'base.css', 'ps-muted'), tokenIn(baseCss, 'base.css', 'ps-bg-deep'))).toBeGreaterThanOrEqual(AA);
  });
});
