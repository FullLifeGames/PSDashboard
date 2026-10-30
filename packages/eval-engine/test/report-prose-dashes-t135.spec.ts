import { test, expect, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Round 67 (T135 point 3): the report's sentence frames carried em dashes
 * (204 of 329 walk summaries, 7 of 10 reports in round 64). The text the app
 * shows is active and dash-free; this checker reads every string and template
 * piece of the prose sources with the TypeScript scanner, so a frame added
 * later cannot bring the dash back. Comments stay out (they are no text).
 */

const PROSE = ['prose/clauses.ts', 'prose/phrases.ts', 'prose/line.ts', 'summary.ts', 'report.ts', 'win-reason.ts', 'denied-end.ts', 'biggest-roll.ts', 'standoff.ts'];

/** Every string literal and template piece of one source file that holds an em or en dash, as "file:line". */
function dashedStrings(file: string): string[] {
  const path = fileURLToPath(new URL(`../src/${file}`, import.meta.url));
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[—–]/.test(node.text)) {
      hits.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe('T135 point 3: the report\'s sentence frames carry no em or en dash', () => {
  test('no string or template piece in the prose sources holds a dash', () => {
    expect(PROSE.flatMap(dashedStrings)).toEqual([]);
  });
});
