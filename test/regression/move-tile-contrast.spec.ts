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
 */
const css = readFileSync(new URL('../../src/styles/pickers.css', import.meta.url), 'utf8');

const token = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css);
  if (!match) throw new Error(`pickers.css declares no --${name}`);
  return match[1];
};

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
