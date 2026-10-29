import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Release 1.0.0 (user 29.10.2026, "1a"): a link to the app posted on Discord, Reddit or X unfurled as a bare
 * "PS Dashboard", since the page carried no preview tags. Crawlers read the static HTML and run no script, so the tags
 * live in index.html. The picture is an absolute address of a file the Pages build publishes from public/, the one the
 * README shows, and the description is the README's first sentence.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const PAGES = 'https://fulllifegames.github.io/PSDashboard/';
const html = readFileSync(join(root, 'index.html'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const meta = (attribute: 'name' | 'property', key: string) =>
  html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`))?.[1];

describe('link preview', () => {
  test('the page names itself and says what it does in the README\'s words', () => {
    const description = meta('name', 'description');
    expect(description).toBeDefined();
    expect(readme).toContain(description!);
    expect(meta('property', 'og:title')).toBe('PS Dashboard');
    expect(meta('property', 'og:description')).toBe(description);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  test('the picture is the README\'s, at an absolute address of a published file', () => {
    const image = meta('property', 'og:image');
    expect(image?.startsWith(PAGES)).toBe(true);
    const file = image!.slice(PAGES.length);
    expect(existsSync(join(root, 'public', file))).toBe(true);
    expect(readme).toContain(`](./public/${file})`);
  });

  // Release 1.0.1: the picture lost its empty margins. A crawler lays out the card from the declared size before it
  // fetches the file, so the size follows the PNG's own header.
  test('the declared size is the picture\'s own', () => {
    const file = meta('property', 'og:image')!.slice(PAGES.length);
    const png = readFileSync(join(root, 'public', file));
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect(meta('property', 'og:image:width')).toBe(String(png.readUInt32BE(16)));
    expect(meta('property', 'og:image:height')).toBe(String(png.readUInt32BE(20)));
  });
});
