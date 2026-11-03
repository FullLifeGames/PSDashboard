import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Round 84 (T315, A7d): the app scales by `zoom` on the root element. The browsers measure the viewport units of a zoomed tree in
 * the window's real pixels, so `100vh` inside it renders at the scale's multiple of the window (the zoom probe of A7c: 1,050 px of
 * a 700 px window at 1.5, Chromium 156 and WebKit 27.2, and `calc(100vh / 1.5)` renders 700). Every vh and vw rule therefore reads
 * the root's two units, `--ps-vh` and `--ps-vw`, which divide by the factor; the factor itself (`--ps-scale`) is the one the store
 * writes. A raw vh or vw anywhere else in `src` would break at 150 %, so the scan holds the tree to it.
 */
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
