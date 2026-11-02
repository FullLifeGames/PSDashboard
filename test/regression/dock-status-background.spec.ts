import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Round 84 (turn dock), step A4 (the integrator's look check of 02.11.2026): the strip above the dock bar had no background, and
 * the loader's text showed through it while the column scrolled behind the sticky dock. The strip paints the dock's opaque
 * background, as the bar does. A6's dock-css spec takes over the narrow-window rules.
 */
const css = readFileSync(new URL('../../src/styles/dock.css', import.meta.url), 'utf8');

describe('the status strip of the dock', () => {
  test('paints an opaque background', () => {
    const rule = /\n\.ps-dock-status \{([^}]*)\}/.exec(css);
    expect(rule, 'dock.css holds a plain .ps-dock-status rule').not.toBeNull();
    const background = /background:\s*([^;]+);/.exec(rule![1]);
    expect(background, 'the strip sets a background').not.toBeNull();
    expect(background![1]).not.toMatch(/rgba\(|transparent/);
  });
});
