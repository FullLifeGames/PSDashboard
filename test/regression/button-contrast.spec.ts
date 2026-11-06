import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contrastRatio } from '../../src/lib/type-colors';

/**
 * Round 87 (release 1.1.0), T313: the app's own buttons. White bold text read 2.5 : 1 on the .ps-btn gradient (3.9 : 1 on
 * .ps-btn-red and on Execute, which paints the same red) and fell further under the hover brightness. Every gradient stop of
 * .ps-btn, .ps-btn-red, the dock's Execute and Start (the class ps-execute-btn-ready) and the numbered circles of the loader's
 * guide now hold white to 4.5 : 1 (WCAG AA for small text), at rest and at the hover brightness of the button's own rule.
 * Round 84's move-tile-contrast.spec.ts holds the dock's selection blue; this spec holds the buttons it left out.
 */
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
