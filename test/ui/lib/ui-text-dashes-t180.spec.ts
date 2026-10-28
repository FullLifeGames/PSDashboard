import { test, expect, describe } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Round 69 (T180): the text the app shows is active and dash-free, as the
 * report prose has been since round 67 (T135). This checker reads every string
 * literal, template piece and JSX text of src/components with the TypeScript
 * scanner and flags an em dash, an en dash and their entities (&mdash;,
 * &ndash;), so a label or a sentence added later cannot bring the dash back.
 * Comments are no text and stay out. A lone em dash is the app's empty value
 * ('—' for a missing number) and stays: as a whole string, or as the only child
 * of a JSX element. A dash piece between expressions in JSX is a sentence
 * joint, not an empty value, and counts.
 */

const DASH = /[—–]|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;/i;
const EMPTY_VALUE = '—';

const hasContent = (child: ts.JsxChild): boolean => !(ts.isJsxText(child) && child.text.trim() === '');

/** Every dashed string, template piece or JSX text of one source, as "line". */
export function dashedTextLines(source: string, fileName = 'x.tsx'): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const flag = (node: ts.Node): void => { lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1); };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text.trim() !== EMPTY_VALUE && (DASH.test(node.text) || DASH.test(node.getText()))) flag(node);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (DASH.test(node.text)) flag(node);
    } else if (ts.isJsxText(node) && DASH.test(node.text)) {
      const parent = node.parent;
      const soleChild = ts.isJsxElement(parent) && parent.children.filter(hasContent).length === 1;
      if (!(soleChild && node.text.trim() === EMPTY_VALUE)) flag(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

const REPO = resolve(__dirname, '../../..');
const COMPONENTS = join(REPO, 'src/components');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('T180: the checker reads what a dash in app text looks like', () => {
  test('strings, template pieces, JSX text and entities are flagged; comments and the empty value are not', () => {
    const source = [
      "const a = 'turns 4–7';",            // 1: en dash in a string
      'const b = `from ${n} — now`;',       // 2: em dash in a template piece
      "const c = '—';",                      // 3: the empty value stays
      'const d = <p>One &mdash; two</p>;',  // 4: entity in JSX text
      'const e = <b>—</b>;',                // 5: sole child, stays
      'const f = <i>{x} — {y}</i>;',        // 6: joint between expressions
      'const g = <u title="a &ndash; b" />;', // 7: entity in an attribute
      '// a comment — with a dash',          // 8: comment, no text
    ].join('\n');
    expect(dashedTextLines(source)).toEqual([1, 2, 4, 6, 7]);
  });
});

describe('T180: src/components shows no em or en dash', () => {
  test('no string, template piece or JSX text holds a dash', () => {
    const hits = sourceFiles(COMPONENTS).flatMap((path) =>
      dashedTextLines(readFileSync(path, 'utf8'), path).map((line) => `${relative(REPO, path).replace(/\\/g, '/')}:${line}`));
    expect(hits).toEqual([]);
  });
});
