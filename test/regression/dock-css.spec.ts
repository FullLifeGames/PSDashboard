import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Round 84 (turn dock), step A6b: the dock in narrow windows. At 1050 px (where the layout stacks) the dock is fixed at the
 * viewport's lower edge across the full width, the page keeps a bottom padding of the dock's height (`--ps-dock-h`, written by
 * `useDockHeight`), the tray opens from below as a sheet of up to 70 % of the viewport, and Execute takes its own row under the
 * chips. At 640 px the chips stay two per row with the app's 640 px sizes (40 px for chips and Execute).
 */
const css = readFileSync(new URL('../../src/styles/dock.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The body of the `@media (max-width: <px>px)` block, found by matching braces; null when the file has none. */
function media(px: number): string | null {
  const start = css.indexOf(`@media (max-width: ${px}px) {`);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

/** The declarations of the rule whose selector list is exactly `selector` inside `block`, or null. */
function rule(block: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(String.raw`(?:^|\n)\s*${escaped}\s*\{([^}]*)\}`).exec(block);
  return match ? match[1] : null;
}

describe('the dock at 1050 px and below', () => {
  const block = media(1050);

  test('the file has the block', () => {
    expect(block, '@media (max-width: 1050px) in dock.css').not.toBeNull();
  });

  test('the dock is fixed at the lower edge across the full width', () => {
    const dock = rule(block ?? '', '.ps-dock');
    expect(dock, 'a .ps-dock rule').not.toBeNull();
    expect(dock).toMatch(/position:\s*fixed/);
    expect(dock).toMatch(/left:\s*0/);
    expect(dock).toMatch(/right:\s*0/);
    expect(dock).toMatch(/bottom:\s*0/);
  });

  test('the page keeps the dock\'s height as bottom padding, read from --ps-dock-h', () => {
    const root = rule(block ?? '', '.ps-app-root');
    expect(root, 'a .ps-app-root rule').not.toBeNull();
    expect(root).toMatch(/padding-bottom:[^;]*var\(--ps-dock-h/);
  });

  test('the tray is a sheet above the dock, up to 70 % of the viewport, also with the dice open', () => {
    const tray = rule(block ?? '', '.ps-tray');
    expect(tray, 'a .ps-tray rule').not.toBeNull();
    expect(tray).toMatch(/position:\s*fixed/);
    expect(tray).toMatch(/bottom:\s*var\(--ps-dock-h/);
    expect(tray).toMatch(/max-height:\s*70vh/);
    expect(rule(block ?? '', '.ps-tray.ps-tray-roomy') ?? '').toMatch(/max-height:\s*70vh/);
  });

  test('Execute takes its own row under the chips', () => {
    expect(rule(block ?? '', '.ps-dock-bar') ?? '').toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    const execute = rule(block ?? '', '.ps-dock .ps-execute-btn');
    expect(execute, 'a rule for Execute').not.toBeNull();
    expect(execute).toMatch(/max-width:\s*none/);
    expect(execute).toMatch(/min-height:\s*36px/);
  });
});

describe('the dock at 640 px and below', () => {
  const block = media(640);

  test('the file has the block', () => {
    expect(block, '@media (max-width: 640px) in dock.css').not.toBeNull();
  });

  test('chips and Execute take the app\'s 40 px minimum height', () => {
    expect(rule(block ?? '', '.ps-dock-chip') ?? '').toMatch(/min-height:\s*40px/);
    expect(rule(block ?? '', '.ps-dock .ps-execute-btn') ?? '').toMatch(/min-height:\s*40px/);
  });

  test('the chips stay two per row and the tray spans the width', () => {
    const rows = rule(block ?? '', '.ps-dock-row');
    // Either the block leaves the row's grid alone or it keeps two columns: never one.
    expect(rows ?? '').not.toMatch(/grid-template-columns:\s*(?:1fr|minmax\(0,\s*1fr\))\s*;/);
    expect(rows ?? '').not.toMatch(/--ps-dock-cols:\s*1/);
    expect(rule(block ?? '', '.ps-tray') ?? '').toMatch(/width:\s*100%/);
  });
});

describe('the tray\'s tiles at 640 px and below', () => {
  const block = media(640);

  test('the move tiles stand two per row, so a name like "Rock Slide" is not cut at 390 px', () => {
    // Round 84 (turn dock, A6c): at 390 px a row of four tiles left about 80 px a tile; two per row leave about 170.
    const grid = rule(block ?? '', '.ps-tile-grid');
    expect(grid, 'a .ps-tile-grid rule in the 640 px block').not.toBeNull();
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  test('wide windows keep four tiles per row', () => {
    expect(css).toMatch(/\.ps-tile-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  });
});
