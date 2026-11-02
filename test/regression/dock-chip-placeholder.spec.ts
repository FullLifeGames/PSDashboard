import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Round 84 (turn dock), step A6a: the chip of a slot the engine has not filled yet. It keeps its box (the grid row sets the chip's
 * size, the pick line its own height), shows an idle bar of that size, shimmers while the run is pending and stands still for
 * a user who asked for less motion. The text it holds is `chipPlaceholder`'s ("engine choosing…").
 */
const css = readFileSync(new URL('../../src/styles/dock.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The declarations of the rule that opens a line with `selector`, or null. */
const rule = (selector: string): string | null => {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe('the placeholder of a chip the engine fills', () => {
  const pending = rule('.ps-dock-pick[data-wait="pending"]');
  const busy = rule('.ps-dock-pick[data-wait="busy"]');

  test('an idle bar of the final size: a background and a rounded corner, no change of width or height', () => {
    expect(pending, 'a rule for the pending placeholder').not.toBeNull();
    expect(pending).toMatch(/background:/);
    expect(pending).toMatch(/border-radius:/);
    expect(pending).not.toMatch(/(?<!min-|max-|line-)(?:width|height):/);
    expect(busy, 'a rule for the busy placeholder').not.toBeNull();
    expect(busy).not.toMatch(/animation:/);
  });

  test('a shimmer runs while the run is pending', () => {
    expect(pending).toMatch(/animation:\s*ps-dock-shimmer\b/);
    expect(css).toMatch(/@keyframes ps-dock-shimmer \{/);
  });

  test('under prefers-reduced-motion the shimmer stops', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/\.ps-dock-pick\[data-wait="pending"\]/);
    expect(block).toMatch(/animation:\s*none/);
  });
});
