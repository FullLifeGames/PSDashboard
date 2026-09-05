import { test, expect, describe } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stylesheet audit: every class selector under src/ is used by a source
 * file, and index.css imports each domain file under src/styles/ once.
 *
 * A class counts as used when a source file contains it as a whole token, or
 * when a template-literal or string-concatenation fragment of at least three
 * characters is a prefix or suffix of it (`ps-combobox-` composes
 * `ps-combobox-option`). The fragment rule is deliberately generous: a rule
 * that survives it is kept, a rule that fails it has no caller anywhere.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

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
