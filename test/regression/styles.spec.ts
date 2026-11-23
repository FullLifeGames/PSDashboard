import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contrastRatio } from '../../src/lib/type-colors';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    // Round 84 (A7d): the vh units divide by the root's scale (`--ps-vh`).
    expect(tray).toMatch(/max-height:\s*calc\(70 \* var\(--ps-vh\)\)/);
    expect(rule(block ?? '', '.ps-tray.ps-tray-roomy') ?? '').toMatch(/max-height:\s*calc\(70 \* var\(--ps-vh\)\)/);
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
    expect(pickers).toMatch(/\.ps-played-badge,\n\.ps-forced-badge,\n\.ps-engine-badge,\n\.ps-guess-badge\s*\{/);
  });

  test('on a move tile it joins the flags above the tile and takes no room', () => {
    expect(css).toMatch(/\.ps-tile-flags \.ps-engine-badge,\n\.ps-tile-flags \.ps-guess-badge\s*\{[^}]*margin:\s*0/);
  });

  // Round 88 (F, #101): a stand-in's tile wears the forced badge's face (same tokens, so the contrast spec covers it) in the same box and
  // the same flag row.
  test('the stand-in badge takes the forced badge\'s colors', () => {
    expect(pickers).toMatch(/\n\.ps-guess-badge \{ background: var\(--ps-badge-forced-bg\); color: var\(--ps-badge-forced-fg\); \}/);
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

describe('layout-css', () => {
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
    test('takes the room that is left down to a floor of one readable entry, the others keep their height', () => {
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

  describe('the top bar above 640 px stays on one line with a long format name', () => {
    // Round 84 (A7f, ruling 19a): the match had `flex: 1 1 auto`, so its basis was its whole text and the support links wrapped before
    // anything shrank. The match takes a zero basis and a floor; inside it the format tag shortens first (a shrink weight far above the
    // names'), the names next; the bar wraps only where even that floor does not fit.
    test('the match has no content basis and a floor that wins over the stacked layout min-width: 0', () => {
      expect(rule(base, '.ps-topbar-match')).toMatch(/flex:\s*1 1 0/);
      const floor = rule(base, '.ps-topbar > .ps-topbar-match');
      expect(floor).toMatch(/min-width:\s*\d+px/);
    });

    test('the format tag shortens first with an ellipsis, the names next, none disappears', () => {
      const tag = rule(base, '.ps-topbar-match > .ps-format-tag');
      expect(tag).toMatch(/flex:\s*0 1000000 auto/);
      expect(tag).toMatch(/min-width:\s*\d/);
      // Every span of the match (tag, names, notes) clips with an ellipsis.
      const clip = rule(base, '.ps-topbar-match > span');
      expect(clip).toMatch(/overflow:\s*hidden/);
      expect(clip).toMatch(/text-overflow:\s*ellipsis/);
      const name = rule(base, '.ps-topbar-match > .ps-player');
      expect(name).toMatch(/min-width:\s*\d/);
      expect(name).not.toMatch(/flex-shrink:\s*0/);
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

  describe('the replay frame at 640 px and below', () => {
    // Round 84 (A7c, ruling 10a): the document shrinks its scene to the frame's width; the frame keeps no 640 px minimum and no sideways scroll.
    test('the frame has no minimum width and its wrapper no horizontal scroll', () => {
      expect(media(layout, 640)).not.toMatch(/min-width:\s*640px/);
      expect(media(layout, 640)).not.toMatch(/\.ps-iframe-wrap\s*\{[^}]*overflow-x:\s*auto/);
    });
  });
});

describe('lead-css', () => {
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
});

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = files(SRC).filter(path => /\.(css|tsx?)$/.test(path)).map(path => ({
  path: path.slice(SRC.length).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
}));
const base = sources.find(source => source.path === 'styles/base.css')!.text;

describe('the root scale in the stylesheet', () => {
  test('html takes its zoom from --ps-scale, 100 % when the property is absent', () => {
    expect(base).toMatch(/html\s*\{[^}]*zoom:\s*var\(--ps-scale,\s*1\)/);
  });

  test('the viewport units are defined once, divided by the factor', () => {
    expect(base).toMatch(/--ps-vh:\s*calc\(1vh\s*\/\s*var\(--ps-scale,\s*1\)\)/);
    expect(base).toMatch(/--ps-vw:\s*calc\(1vw\s*\/\s*var\(--ps-scale,\s*1\)\)/);
  });

  test('no other rule or style in src uses a viewport unit raw', () => {
    const raw = /(?<![-\w.])\d+(?:\.\d+)?(?:vh|vw|dvh|dvw|svh|svw|lvh|lvw|vmin|vmax)\b/g;
    const found: string[] = [];
    for (const { path, text } of sources) {
      text.split('\n').forEach((line, index) => {
        if (path === 'styles/base.css' && /--ps-v[hw]:\s*calc\(1v[hw]/.test(line)) return;
        if (raw.test(line)) found.push(`${path}:${index + 1}: ${line.trim()}`);
        raw.lastIndex = 0;
      });
    }
    expect(found).toEqual([]);
  });

  test('the rules that read the window\'s height and width go through the units', () => {
    const text = (path: string) => sources.find(source => source.path === path)!.text;
    expect(text('styles/layout.css')).toContain('height: calc(100 * var(--ps-vh))');
    expect(text('styles/layout.css')).toContain('min-height: calc(100 * var(--ps-vh))');
    expect(text('styles/base.css')).toContain('min-height: calc(100 * var(--ps-vh))');
    expect(text('styles/dock.css')).toContain('min(560px, calc(70 * var(--ps-vh)))');
    expect(text('styles/dock.css')).toContain('max-height: calc(70 * var(--ps-vh))');
    expect(text('styles/lead.css')).toContain('max-height: calc(60 * var(--ps-vh))');
    expect(text('styles/loader.css')).toContain('calc(100 * var(--ps-vw) - 14px)');
    expect(text('components/ModalDialog.tsx')).toContain('calc(80 * var(--ps-vh))');
  });
});

describe('css-audit', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));

  function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file, keep, out);
      else if (keep(file)) out.push(file);
    }
    return out;
  }

  const stylesheets = () => walk(join(root, 'src'), file => file.endsWith('.css')).sort();

  const sources = () => [
    ...walk(join(root, 'src'), file => /\.tsx?$/.test(file)),
    ...walk(join(root, 'packages'), file => /\.ts$/.test(file) && /[\\/]src[\\/]/.test(file)),
    join(root, 'index.html'),
  ];

  /** Class names from every selector prelude (declarations and comments excluded). */
  function classSelectors(css: string): Set<string> {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const classes = new Set<string>();
    const stack: string[] = [];
    let prelude = '';
    for (const ch of text) {
      if (ch === '{') {
        const trimmed = prelude.trim();
        stack.push(trimmed.startsWith('@') ? 'at' : 'rule');
        if (!trimmed.startsWith('@')) {
          for (const match of trimmed.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) classes.add(match[1]);
        }
        prelude = '';
      } else if (ch === '}') {
        stack.pop();
        prelude = '';
      } else if (ch === ';' && (stack.length === 0 || stack[stack.length - 1] === 'at')) {
        prelude = '';
      } else {
        prelude += ch;
      }
    }
    return classes;
  }

  /** Static fragments that may compose a class name at runtime. */
  function fragments(texts: string[]): { prefixes: Set<string>; suffixes: Set<string> } {
    const prefixes = new Set<string>();
    const suffixes = new Set<string>();
    for (const text of texts) {
      for (const match of text.matchAll(/(?:`|\})([^`${}]*)\$\{/g)) {
        const tail = /[\w-]+$/.exec(match[1]);
        if (tail) prefixes.add(tail[0]);
      }
      for (const match of text.matchAll(/\}([^`${}]*)`/g)) {
        const head = /^[\w-]+/.exec(match[1]);
        if (head) suffixes.add(head[0]);
      }
      for (const match of text.matchAll(/['"]([\w-]+)['"]\s*\+/g)) prefixes.add(match[1]);
      for (const match of text.matchAll(/\+\s*['"]([\w-]+)['"]/g)) suffixes.add(match[1]);
    }
    const usable = (set: Set<string>) => new Set([...set].filter(fragment => fragment.length >= 3));
    return { prefixes: usable(prefixes), suffixes: usable(suffixes) };
  }

  const escape = (value: string) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  describe('stylesheet audit', () => {
    test('every class selector is used by a source file', () => {
      const classes = new Set<string>();
      for (const file of stylesheets()) for (const cls of classSelectors(readFileSync(file, 'utf8'))) classes.add(cls);
      const texts = sources().map(file => readFileSync(file, 'utf8'));
      const { prefixes, suffixes } = fragments(texts);
      const dead = [...classes].filter(cls => {
        const token = new RegExp(`(^|[^\\w-])${escape(cls)}(?![\\w-])`);
        if (texts.some(text => token.test(text))) return false;
        if ([...prefixes].some(fragment => cls.startsWith(fragment))) return false;
        return ![...suffixes].some(fragment => cls.endsWith(fragment));
      }).sort();
      expect(dead, 'classes no source file references').toEqual([]);
    });

    test('index.css imports Tailwind and each domain file under src/styles once', () => {
      const index = readFileSync(join(root, 'src', 'index.css'), 'utf8');
      const imports = [...index.matchAll(/@import\s+["']([^"']+)["']/g)].map(match => match[1]);
      expect(imports[0]).toBe('tailwindcss');
      const domainFiles = walk(join(root, 'src', 'styles'), file => file.endsWith('.css'))
        .map(file => './' + relative(join(root, 'src'), file).replace(/\\/g, '/'))
        .sort();
      expect([...imports.slice(1)].sort()).toEqual(domainFiles);
      expect(new Set(imports).size).toBe(imports.length);
      if (domainFiles.length > 0) {
        expect(index.replace(/\/\*[\s\S]*?\*\//g, ''), 'index.css holds imports only').not.toContain('{');
      }
    });
  });
});

describe('dock-status-background', () => {
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
});

describe('dock-chip-placeholder', () => {
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
});
