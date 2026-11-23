import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contrastRatio, TYPE_BG, typeTileVars } from '../../src/lib/type-colors';

// Every gradient stop of .ps-btn, .ps-btn-red, the dock's Execute and Start (the class ps-execute-btn-ready) and the numbered
// circles of the loader's guide holds white to 4.5 : 1 (WCAG AA for small text), at rest and at the hover brightness of the
// button's own rule.
const read = (file: string): string => readFileSync(new URL(`../../src/styles/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const formsCss = read('forms.css');
const dockCss = read('dock.css');
const loaderCss = read('loader.css');

const AA = 4.5;
const WHITE = '#ffffff';

/** The declarations of the rule whose selector list starts with `selector` (at the start of a line). */
function ruleOf(source: string, file: string, selector: string): string {
  const start = source.indexOf(`\n${selector}`);
  if (start < 0) throw new Error(`${file} has no rule starting ${selector}`);
  const open = source.indexOf('{', start);
  return source.slice(open + 1, source.indexOf('}', open));
}

/** The two hex stops of the rule's `linear-gradient(180deg, #top 0%, #bottom 100%)`. */
function stopsOf(source: string, file: string, selector: string): [string, string] {
  const match = /linear-gradient\(180deg,\s*(#[0-9a-fA-F]{6}) 0%,\s*(#[0-9a-fA-F]{6}) 100%\)/.exec(ruleOf(source, file, selector));
  if (!match) throw new Error(`${file} ${selector} has no two-stop hex gradient`);
  return [match[1], match[2]];
}

/** The factor of the `filter: brightness(f)` in a rule's declarations. */
function brightnessOf(source: string, file: string, selector: string): number {
  const match = /filter:\s*brightness\(([\d.]+)\)/.exec(ruleOf(source, file, selector));
  if (!match) throw new Error(`${file} ${selector} has no brightness filter`);
  return Number(match[1]);
}

/** What `filter: brightness(f)` does to a color: every sRGB channel times f, clamped at 255. */
function brightened(color: string, factor: number): string {
  const channels = [1, 3, 5].map(index => Math.min(255, Math.round(parseInt(color.slice(index, index + 2), 16) * factor)));
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

interface Button {
  name: string;
  stops: [string, string];
  /** Hover brightness of the button's own rule; none for the guide's circles, which do not hover. */
  hover: number | null;
}

const BUTTONS: Button[] = [
  {
    name: '.ps-btn',
    stops: stopsOf(formsCss, 'forms.css', '.ps-btn {'),
    hover: brightnessOf(formsCss, 'forms.css', '.ps-btn:hover'),
  },
  {
    name: '.ps-btn-red',
    stops: stopsOf(formsCss, 'forms.css', '.ps-btn-red {'),
    // the red buttons carry .ps-btn too, so its hover rule applies to them
    hover: brightnessOf(formsCss, 'forms.css', '.ps-btn:hover'),
  },
  {
    name: 'Execute and Start (.ps-execute-btn-ready)',
    stops: stopsOf(dockCss, 'dock.css', '.ps-dock .ps-execute-btn-ready'),
    hover: brightnessOf(dockCss, 'dock.css', '.ps-dock .ps-execute-btn:hover'),
  },
  {
    name: 'the loader guide steps',
    stops: stopsOf(loaderCss, 'loader.css', '.ps-guide-step span {'),
    hover: null,
  },
];

describe('white text reads 4.5 : 1 on every stop of an app button', () => {
  describe.each(BUTTONS)('$name', ({ stops, hover }) => {
    test.each([
      ['top', 0],
      ['bottom', 1],
    ])('the %s stop at rest', (_label, index) => {
      expect(contrastRatio(WHITE, stops[index])).toBeGreaterThanOrEqual(AA);
    });

    test.each([
      ['top', 0],
      ['bottom', 1],
    ])('the %s stop under the hover brightness', (_label, index) => {
      if (hover === null) return;
      expect(contrastRatio(WHITE, brightened(stops[index], hover))).toBeGreaterThanOrEqual(AA);
    });
  });
});

test('the hover brightness model matches the factors the rules declare', () => {
  expect(brightened('#808080', 1.5)).toBe('#c0c0c0');
  expect(brightened('#ffffff', 1.12)).toBe('#ffffff');
  expect(BUTTONS.find(button => button.name.startsWith('.ps-btn-red'))?.hover).toBe(1.12);
  expect(BUTTONS.find(button => button.name.startsWith('Execute'))?.hover).toBe(1.1);
});

describe('move-tile-contrast', () => {
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
});
