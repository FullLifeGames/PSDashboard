import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Round 84 (turn dock), step A6b: the dock in narrow windows. At 1050 px (where the layout stacks) the dock is fixed at the
 * viewport's lower edge across the full width, the page keeps a bottom padding of the dock's height (`--ps-dock-h`, written by
 * `useDockHeight`), the tray opens from below as a sheet of up to 70 % of the viewport, and Execute takes its own row under the
 * chips. At 640 px the chips take one row each (A7c, ruling 11a) at the dock's 46 px, with the app's 640 px sizes (40 px minimum for chips and Execute).
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

  test('the chips take one row each at 46 px, and the tray spans the width', () => {
    // Round 84 (A7c, ruling 11a): two chips a row cut the choice after about twelve letters at 390 px; one a row (doubles four rows,
    // singles two) leaves the whole choice and A7b's tag or sprite.
    const row = rule(block ?? '', '.ps-dock-row') ?? '';
    expect(row).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    expect(row).toMatch(/grid-auto-rows:\s*46px/);
    // The rows' own track no longer fixes the height of a row that holds two chips.
    expect(rule(block ?? '', '.ps-dock-rows') ?? '').toMatch(/grid-auto-rows:\s*auto/);
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

describe('the dock above 1050 px: the label of Execute never moves a chip', () => {
  // Round 84 (turn dock, A6d): the Execute column was `auto`, so the label ("Select all active choices", "Waits for engine…",
  // "Execute Turn") sized it and the chip columns beside it changed width by a few pixels (P1A: 4.3 px in the Q19 b scene).
  // The column is a fixed width that fits every label; the button fills it and wraps a long label.
  const base = css.slice(0, css.indexOf('@media (max-width: 1050px)'));

  test('the chips share the bar with a column of fixed width', () => {
    const bar = rule(base, '.ps-dock-bar');
    expect(bar, 'a .ps-dock-bar rule').not.toBeNull();
    const columns = /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+(\S+)\s*;/.exec(bar ?? '');
    expect(columns, 'the bar has the chips and one more column').not.toBeNull();
    expect(columns![1]).toBe('150px');
  });

  test('Execute fills its column whatever it reads, so its content never sizes the column', () => {
    const execute = rule(base, '.ps-dock .ps-execute-btn');
    expect(execute, 'a rule for Execute').not.toBeNull();
    expect(execute).toMatch(/width:\s*100%/);
    expect(execute).toMatch(/min-width:\s*0/);
    expect(execute).toMatch(/max-width:\s*none/);
  });

  test('the rows keep one height whatever the chips and Execute read', () => {
    expect(rule(base, '.ps-dock-rows') ?? '').toMatch(/grid-auto-rows:\s*46px/);
  });
});

describe('the HP bar of a bench tile', () => {
  // Round 84 (turn dock, A7a): the fill is a span; without `display: block` it stays inline and its width does nothing, so every bench
  // tile showed the bare grey track, at 15 % as at 100 %. The only users of `.ps-hpbar-fill` are the dock's bench tiles.
  const pickers = readFileSync(new URL('../../src/styles/pickers.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  test('the fill is a block, so its inline width sets the bar', () => {
    const fill = rule(`${pickers}\n${css}`, '.ps-hpbar-fill');
    expect(fill, 'a .ps-hpbar-fill rule').not.toBeNull();
    expect(fill).toMatch(/display:\s*block/);
  });

  test('the track clips the fill and the dock sets it to a block of its own width', () => {
    expect(rule(pickers, '.ps-hpbar-track') ?? '').toMatch(/overflow:\s*hidden/);
    expect(rule(css, '.ps-switch-hp-track') ?? '').toMatch(/display:\s*block/);
  });
});

describe('the engine badge of a tile', () => {
  // Round 84 (A7a): the engine's held-back pick wears the played badge's face (same tokens, so the contrast spec covers it), shares the
  // badge box rules, and sits in the tile's flag row beside the played and forced badges.
  const pickers = readFileSync(new URL('../../src/styles/pickers.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  test('it takes the played badge\'s colors and the shared box of the badges', () => {
    expect(pickers).toMatch(/\n\.ps-engine-badge \{ background: var\(--ps-badge-played-bg\); color: var\(--ps-badge-played-fg\); \}/);
    expect(pickers).toMatch(/\.ps-played-badge,\n\.ps-forced-badge,\n\.ps-engine-badge\s*\{/);
  });

  test('on a move tile it joins the flags above the tile and takes no room', () => {
    expect(css).toMatch(/\.ps-tile-flags \.ps-engine-badge\s*\{[^}]*margin:\s*0/);
  });
});

describe("the dock follows the column's content (ruling 4a)", () => {
  // Round 84 (A7a): `.ps-dock-log { margin-top: auto }` pushed the toggle and the dock to the foot of a tall column, and a gap of about
  // 400 px opened under the timeline at 2560 x 1440. The dock now stands directly under the last panel; it stays sticky at the column's
  // foot when the content is longer than the window, and the tray stays absolute above the bar, so a tray moves no chip.
  const base = css.slice(0, css.indexOf('@media (max-width: 1050px)'));
  const narrow = media(1050) ?? '';

  test('the log toggle takes no auto margin', () => {
    const log = rule(css, '.ps-dock-log');
    expect(log === null || !/margin(-top)?:\s*auto/.test(log), 'no auto margin on .ps-dock-log').toBe(true);
  });

  test("the dock stays sticky at the column's foot, and the tray stays above the bar", () => {
    expect(rule(base, '.ps-dock') ?? '').toMatch(/position:\s*sticky/);
    expect(rule(base, '.ps-dock') ?? '').toMatch(/bottom:\s*0/);
    expect(rule(base, '.ps-tray') ?? '').toMatch(/position:\s*absolute/);
    expect(rule(base, '.ps-tray') ?? '').toMatch(/bottom:\s*100%/);
  });

  test('the bar is closed at the bottom: a bottom border and all four corners round', () => {
    const bar = rule(base, '.ps-dock-bar') ?? '';
    expect(bar).toMatch(/border:\s*1px solid/);
    expect(bar).not.toMatch(/border-bottom:\s*0/);
    expect(bar).toMatch(/border-radius:\s*10px\s*;/);
  });

  test('a tray joins the bar at the top: the bar keeps square top corners under it', () => {
    expect(rule(base, '.ps-tray + .ps-dock-bar') ?? '').toMatch(/border-top-left-radius:\s*0;\s*border-top-right-radius:\s*0/);
  });

  test('below 1050 px, where the dock is fixed at the lower edge, the bar keeps its open bottom', () => {
    const bar = rule(narrow, '.ps-dock-bar') ?? '';
    expect(bar).toMatch(/border-bottom:\s*0/);
    expect(bar).toMatch(/border-radius:\s*10px 10px 0 0/);
  });
});

describe('the hit bar (variant F, A7b)', () => {
  const grey = 'rgba(255, 255, 255, 0.24)';

  test('what stays is grey, the roll and the lowest roll take the hit\'s tone', () => {
    expect(rule(css, '.ps-hitbar-rest')).toContain(grey);
    expect(rule(css, '.ps-hitbar-sure')).toMatch(/#00e800/);
    expect(rule(css, '.ps-hitbar-roll')).toMatch(/#00d000/);
    for (const [tone, solid, striped] of [['yellow', '#f0d000', '#e0c000'], ['red', '#f02020', '#e02020']]) {
      expect(rule(css, `.ps-hitbar[data-tone="${tone}"] .ps-hitbar-sure`)).toContain(solid);
      expect(rule(css, `.ps-hitbar[data-tone="${tone}"] .ps-hitbar-roll`)).toContain(striped);
    }
  });

  test('the legend has a grey swatch and three tones for each of the two colored parts', () => {
    expect(rule(css, '.ps-legend-rest')).toContain(grey);
    for (const part of ['sure', 'roll']) {
      for (const tone of ['green', 'yellow', 'red']) expect(rule(css, `.ps-legend-${part}-${tone}`), `${part} ${tone}`).not.toBeNull();
    }
  });
});

describe('the chip (variant A, ruling 8a)', () => {
  const base = css.slice(0, css.indexOf('@media (max-width: 1050px)'));
  const chip = rule(base, '.ps-dock-chip') ?? '';

  test("the type is the tile's 4 px edge on the left, in the tile's color source, and no bar on top", () => {
    expect(chip).toMatch(/border-left:\s*4px solid var\(--type,\s*rgba\(183, 216, 255, 0\.22\)\)/);
    expect(chip).not.toMatch(/inset 0 3px 0/);
    expect(rule(base, '.ps-movebtn') ?? '').toMatch(/border-left:\s*4px solid var\(--type,\s*rgba\(183, 216, 255, 0\.22\)\)/);
  });

  test('three columns: the label, the middle with both lines, the aside across both lines', () => {
    expect(chip).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\);/);
    expect(rule(base, '.ps-dock-chip[data-aside="true"]') ?? '').toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/);
    const aside = rule(base, '.ps-dock-aside') ?? '';
    expect(aside).toMatch(/grid-column:\s*3/);
    expect(aside).toMatch(/grid-row:\s*1\s*\/\s*3/);
  });

  test('every chip keeps the same left edge and padding, so the empty chip keeps its box', () => {
    expect(chip).toMatch(/padding:\s*4px 10px 4px 8px/);
  });

  test('the sprite is 32 px, which fits the 46 px row with the chip\'s padding', () => {
    const sprite = rule(base, '.ps-dock-sprite') ?? '';
    expect(sprite).toMatch(/width:\s*32px/);
    expect(sprite).toMatch(/height:\s*32px/);
    expect(rule(base, '.ps-dock-rows') ?? '').toMatch(/grid-auto-rows:\s*46px/);
  });
});

describe('the bench tile badges never change the tile (A7b)', () => {
  const base = css.slice(0, css.indexOf('@media (max-width: 1050px)'));

  test('the bench tile is the containing block of the flag row, and the flags stand out of the flow', () => {
    expect(rule(base, '.ps-dock .ps-switchbtn') ?? '').toMatch(/position:\s*relative/);
    expect(rule(base, '.ps-tile-flags') ?? '').toMatch(/position:\s*absolute/);
  });

  test('the bench rows leave room for the flags of the row below', () => {
    expect(rule(base, '.ps-switch-row') ?? '').toMatch(/gap:\s*10px 6px/);
  });
});
