import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Round 84 (turn dock), A7b, ruling 9a: the two columns share one grid row whose height follows the left column's content (the
 * dock's foot), capped at the layout's own height (`--ps-layout-h`, written by `useLayoutHeight`). The right column adds nothing
 * to the row (`contain: size`) and ends on the dock's foot; Evaluation and Play out keep their height at the top, and the Battle
 * Statistics panel takes the rest as a closed panel whose list scrolls under its heading. Below 1050 px the columns stack.
 */
const read = (name: string) => readFileSync(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layout = read('layout.css');
const stats = read('stats-panel.css');

function media(css: string, px: number): string {
  const start = css.indexOf(`@media (max-width: ${px}px) {`);
  expect(start, `@media (max-width: ${px}px)`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const match = new RegExp(String.raw`(?:^|\n)\s*${escaped}\s*\{([^}]*)\}`).exec(css);
  expect(match, `a rule for ${selector}`).not.toBeNull();
  return match![1];
}

const base = layout.slice(0, layout.indexOf('@media (max-width: 1050px)'));
const narrow = media(layout, 1050);
const narrowStats = media(stats, 1050);

describe('the two columns above 1050 px', () => {
  test('one grid row that starts at the top and follows the left column', () => {
    const grid = rule(base, '.ps-main-layout');
    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+380px/);
    expect(grid).toMatch(/align-content:\s*start/);
  });

  test('the left column scrolls inside the layout\'s height, not beyond it', () => {
    expect(rule(base, '.ps-main-left')).toMatch(/max-height:\s*var\(--ps-layout-h,\s*100%\)/);
  });

  test('the left column has no padding below the dock, so the shared row ends on the foot of the dock', () => {
    // Round 84 (A7c, item 0a): a padding-bottom of 12px made the row 12px longer than the dock, and the right column reached past it.
    expect(rule(base, '.ps-main-left')).not.toMatch(/padding-bottom:\s*[1-9]/);
  });

  test('the right column adds no height to the row and scrolls only itself', () => {
    const right = rule(base, '.ps-main-right');
    expect(right).toMatch(/contain:\s*size/);
    expect(right).toMatch(/overflow-y:\s*auto/);
    expect(right).not.toMatch(/max-height/);
  });
});

describe('the Battle Statistics panel', () => {
  test('takes the room that is left and may shrink to its heading, the others keep their height', () => {
    const panel = rule(stats, '.ps-main-right > .ps-stats-panel');
    expect(panel).toMatch(/flex:\s*1 1 auto/);
    expect(panel).toMatch(/min-height:\s*\d+px/);
    expect(panel).toMatch(/display:\s*flex/);
    expect(panel).toMatch(/flex-direction:\s*column/);
    expect(panel).toMatch(/overflow:\s*hidden/);
    expect(rule(layout, '.ps-main-right > :not(.ps-stats-panel)')).toMatch(/flex:\s*0 0 auto/);
  });

  test('the list scrolls under the heading and fades over its last 36 px while more follows', () => {
    const list = rule(stats, '.ps-stats-panel > .ps-stats-grid');
    expect(list).toMatch(/flex:\s*1 1 auto/);
    expect(list).toMatch(/min-height:\s*0/);
    expect(list).toMatch(/overflow-y:\s*auto/);
    const fade = rule(stats, '.ps-stats-panel > .ps-stats-grid[data-more="true"]');
    expect(fade).toMatch(/mask-image:\s*linear-gradient\(to bottom,\s*#000 calc\(100% - 36px\),\s*transparent\)/);
    expect(fade).toMatch(/-webkit-mask-image/);
  });
});

describe('the columns below 1050 px', () => {
  test('stack, with nothing of the grid left', () => {
    const layoutRule = rule(narrow, '.ps-main-layout');
    expect(layoutRule).toMatch(/display:\s*flex/);
    expect(layoutRule).toMatch(/flex-direction:\s*column/);
    expect(rule(narrow, '.ps-main-left')).toMatch(/max-height:\s*none/);
    const right = rule(narrow, '.ps-main-right');
    expect(right).toMatch(/contain:\s*none/);
    expect(right).toMatch(/overflow-y:\s*visible/);
  });

  test('the panel is a plain panel again', () => {
    const panel = rule(narrowStats, '.ps-main-right > .ps-stats-panel');
    expect(panel).toMatch(/overflow:\s*visible/);
    expect(rule(narrowStats, '.ps-stats-panel > .ps-stats-grid')).toMatch(/overflow-y:\s*visible/);
  });
});

describe('the top bar at 640 px and below', () => {
  // Round 84 (A7c, ruling 11a): the bar took three lines (74 px at 390 px); two at most: the match, then the menus with the support links.
  const phone = media(layout, 640);

  test('the match takes the first line, the menus and the support links share the second', () => {
    const bar = rule(phone, '.ps-topbar');
    expect(bar).toMatch(/flex-direction:\s*row/);
    expect(bar).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(phone, '.ps-topbar-match')).toMatch(/flex:\s*1 0 100%/);
    const actions = rule(phone, '.ps-topbar > .ps-topbar-actions');
    expect(actions).toMatch(/flex-wrap:\s*nowrap/);
    expect(actions).toMatch(/min-width:\s*0/);
    const links = rule(phone, '.ps-topbar > .ps-support-links');
    expect(links).toMatch(/flex-wrap:\s*nowrap/);
    expect(links).toMatch(/white-space:\s*nowrap/);
  });

  test('the name of the app leaves the bar, the links stay', () => {
    expect(rule(phone, '.ps-topbar .ps-support-name')).toMatch(/display:\s*none/);
  });
});
