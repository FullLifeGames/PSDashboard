import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contrastRatio } from '../../src/lib/type-colors';

/**
 * Round 84 (turn dock), A7b, ruling 12b: the turn 0 lead picker wears the dock's look. It reads the dock's rules (its root is a
 * dock) and adds a few of its own in `lead.css`; the rules of its old compact look left `pickers.css`.
 */
const read = (name: string) => readFileSync(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lead = read('lead.css');
const pickers = read('pickers.css');
const index = read('../index.css');

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const match = new RegExp(String.raw`(?:^|\n)\s*${escaped}\s*\{([^}]*)\}`).exec(css);
  expect(match, `a rule for ${selector}`).not.toBeNull();
  return match![1];
}
const token = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(pickers);
  expect(match, `token --${name}`).not.toBeNull();
  return match![1];
};

describe('the lead picker styles', () => {
  test('lead.css comes after dock.css, so the picker can override nothing of the dock by accident', () => {
    expect(index.indexOf('styles/lead.css')).toBeGreaterThan(index.indexOf('styles/dock.css'));
  });

  test('the order mark reads like a badge: the forced badge colors, which the contrast spec holds', () => {
    const mark = rule(lead, '.ps-lead-slot');
    expect(mark).toMatch(/background:\s*var\(--ps-badge-forced-bg\)/);
    expect(mark).toMatch(/color:\s*var\(--ps-badge-forced-fg\)/);
    expect(contrastRatio(token('ps-badge-forced-fg'), token('ps-badge-forced-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  test('on a phone the fixed bar keeps to 60 % of the window and scrolls inside', () => {
    const start = lead.indexOf('@media (max-width: 1050px) {');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = lead.slice(start);
    expect(block).toMatch(/\.ps-lead \.ps-dock-bar\s*\{[^}]*max-height:\s*calc\(60 \* var\(--ps-vh\)\)[^}]*overflow-y:\s*auto/);
  });

  test('the sides stand in rows and take the full width of their column', () => {
    expect(rule(lead, '.ps-lead-rows')).toMatch(/display:\s*grid/);
    expect(rule(lead, '.ps-lead-rows')).toMatch(/min-width:\s*0/);
    expect(rule(lead, '.ps-lead-side')).toMatch(/display:\s*grid/);
  });
});

describe('what left pickers.css with the old compact look', () => {
  test.each([
    '.ps-controls', '.ps-side-controls', '.ps-whatdo', '.ps-side-label', '.ps-switchgrid', '.ps-switchgrid-compact',
    '.ps-switchbtn-compact', '.ps-lead-slot', '.ps-execute-wrap', '.ps-branch-controls-shell', '.ps-branch-controls-grid',
    '.ps-branch-side-column', '.ps-side-divider',
  ])('%s', selector => {
    const escaped = selector.replace(/[.]/g, '\\.');
    expect(pickers).not.toMatch(new RegExp(`${escaped}(?![-\\w])`));
  });

  test('what the dock and the picker share stays', () => {
    for (const selector of ['.ps-switchbtn {', '.ps-execute-btn {', '.ps-played-badge,', '.ps-hpbar-track {']) expect(pickers).toContain(selector);
  });
});
