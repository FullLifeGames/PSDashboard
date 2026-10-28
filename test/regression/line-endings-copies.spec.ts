import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Round 72 (T236): packages/eval-engine/src/line-endings.ts is a deliberate copy of packages/replay-core/src/line-endings.ts.
 * replay-core's helper is no part of its barrel (the package API is pinned by test/regression/fixtures/api/) and the engine reaches
 * replay-core by its barrel only, so the engine keeps its own text. AGENTS.md asks a deliberate copy for a spec that compares the
 * two: this one holds the function bodies equal and runs both over a table of logs. normalizeLines belongs to the engine alone
 * (the readers that take a turn's lines are engine functions); the test below says so.
 *
 * The function does not depend on the game type; the table runs a singles and a doubles log all the same.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
const ENGINE = 'packages/eval-engine/src/line-endings.ts';
const CORE = 'packages/replay-core/src/line-endings.ts';

/** The text of `export function <name>(...) { ... }`, from its signature to the closing brace at the start of a line. */
function functionText(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`no export function ${name}`);
  const end = source.indexOf('\n}', start);
  if (end < 0) throw new Error(`${name} has no closing brace at a line start`);
  return source.slice(start, end + 2);
}

/** Null when the two copies read the same, otherwise what differs. Whitespace at line ends and CRLF checkouts do not count. */
function copyDifference(a: string, b: string): string | null {
  const lines = (text: string) => text.split(/\r?\n/).map(line => line.trimEnd());
  const left = lines(a);
  const right = lines(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return `line ${i + 1}: ${JSON.stringify(left[i])} against ${JSON.stringify(right[i])}`;
  }
  return null;
}

/** Runs the exported function of a TypeScript source text: the same transpile for both copies. */
function compile(text: string, name: string): (input: string) => string {
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('exports', js)(exports);
  return exports[name] as (input: string) => string;
}

const engineText = functionText(read(ENGINE), 'normalizeLineEndings');
const coreText = functionText(read(CORE), 'normalizeLineEndings');

const fixtureLog = (file: string): string => (JSON.parse(readFileSync(fileURLToPath(new URL(`../../packages/eval-engine/test/fixtures/${file}`, import.meta.url)), 'utf8')) as { log: string }).log;
const SINGLES_LOG = fixtureLog('smogtours-gen6ou-655336.json');
const DOUBLES_LOG = fixtureLog('smogtours-gen9doublesou-938276.json');

const TABLE: Array<[string, string]> = [
  ['empty', ''],
  ['no line break', '|turn|1'],
  ['LF', '|turn|1\n|move|p1a: A|Tackle|p2a: B\n'],
  ['CRLF', '|turn|1\r\n|move|p1a: A|Tackle|p2a: B\r\n'],
  ['lone CR', '|turn|1\r|move|p1a: A|Tackle|p2a: B\r'],
  ['mixed', '|turn|1\r\n|turn|2\n|turn|3\r|turn|4\r\n\r\n'],
  ['CR before LF at the end only', '|turn|1\n|turn|2\r\n'],
  ['singles log, LF', SINGLES_LOG],
  ['singles log, CRLF', SINGLES_LOG.replace(/\n/g, '\r\n')],
  ['doubles log, LF', DOUBLES_LOG],
  ['doubles log, CRLF', DOUBLES_LOG.replace(/\n/g, '\r\n')],
];

describe('the two line-endings.ts copies (T236)', () => {
  test('the function bodies read the same', () => {
    expect(copyDifference(engineText, coreText)).toBeNull();
  });

  test('the comparison sees a planted difference', () => {
    // The mutation the spec exists for: a copy that drops the lone CR.
    const mutated = coreText.replace('/\\r\\n?/g', '/\\r\\n/g');
    expect(mutated).not.toBe(coreText);
    expect(copyDifference(engineText, mutated)).toMatch(/^line \d+: /);
    expect(copyDifference(engineText, coreText.replace("'\\n'", "'\\r\\n'"))).not.toBeNull();
    // A line missing at the end counts as well.
    expect(copyDifference(engineText, `${coreText}\n// more`)).not.toBeNull();
  });

  test('both copies give the same answer over the table, and the answer holds LF only', () => {
    const engine = compile(engineText, 'normalizeLineEndings');
    const core = compile(coreText, 'normalizeLineEndings');
    for (const [name, text] of TABLE) {
      const answer = engine(text);
      expect(core(text), name).toBe(answer);
      expect(answer, name).not.toContain('\r');
    }
    // CRLF and LF forms of one log read the same.
    expect(engine(SINGLES_LOG.replace(/\n/g, '\r\n'))).toBe(engine(SINGLES_LOG));
    expect(core(DOUBLES_LOG.replace(/\n/g, '\r\n'))).toBe(core(DOUBLES_LOG));
  });

  test('an LF text comes back as the same string in both copies', () => {
    const engine = compile(engineText, 'normalizeLineEndings');
    const core = compile(coreText, 'normalizeLineEndings');
    for (const text of ['', SINGLES_LOG, DOUBLES_LOG]) {
      expect(engine(text)).toBe(text);
      expect(core(text)).toBe(text);
    }
  });

  test('normalizeLines stays in the engine; replay-core has no copy of it', () => {
    expect(read(ENGINE)).toContain('export function normalizeLines(');
    expect(read(CORE)).not.toContain('normalizeLines');
  });
});
