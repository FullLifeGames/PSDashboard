import { readFileSync } from 'node:fs';
import { expect, test, describe } from 'vitest';
import { GAME_ENDED_WORDS as ROW_ENDED_WORDS, NEVER_ACTED_WORDS as ROW_WORDS, neverActedText, noChoiceText } from '../../src/components/eval/turn-copy';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// The app copies the engine's phrase (barrel access only); this spec reads the engine's source and holds the two equal.
const phrases = readFileSync(new URL('../../packages/eval-engine/src/prose/phrases.ts', import.meta.url), 'utf-8');
const engineWords = /export const NEVER_ACTED_WORDS =\s*'([^']+)'/.exec(phrases)?.[1];
const engineEndedWords = /export const GAME_ENDED_WORDS =\s*'([^']+)'/.exec(phrases)?.[1];

test('the app row and the engine sentences use one wording for a side knocked out before it moved', () => {
  expect(engineWords).toBeDefined();
  expect(ROW_WORDS).toBe(engineWords);
  expect(neverActedText({ played: null })).toBe(engineWords);
  expect(neverActedText({ played: { ev: 0 } })).toMatch(new RegExp(`^${engineWords} · staying in \\d+%$`));
});

test('the app row and the engine note use one wording for a doubles slot with no logged action', () => {
  expect(engineEndedWords).toBeDefined();
  expect(ROW_ENDED_WORDS).toBe(engineEndedWords);
  expect(noChoiceText([{ slot: 0, reason: 'fell' }], ['Orthworm'])).toBe(`Orthworm was ${engineWords}`);
  expect(noChoiceText([{ slot: 1, reason: 'ended' }])).toBe(`Slot B was ${engineEndedWords}`);
});

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
const ENGINE = 'packages/eval-engine/src/line-endings.ts';
const CORE = 'packages/replay-core/src/line-endings.ts';

function functionText(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`no export function ${name}`);
  const end = source.indexOf('\n}', start);
  if (end < 0) throw new Error(`${name} has no closing brace at a line start`);
  return source.slice(start, end + 2);
}

function copyDifference(a: string, b: string): string | null {
  const lines = (text: string) => text.split(/\r?\n/).map(line => line.trimEnd());
  const left = lines(a);
  const right = lines(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return `line ${i + 1}: ${JSON.stringify(left[i])} against ${JSON.stringify(right[i])}`;
  }
  return null;
}

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

describe('the two line-endings.ts copies', () => {
  test('the function bodies read the same', () => {
    expect(copyDifference(engineText, coreText)).toBeNull();
  });

  test('the comparison sees a planted difference', () => {
    const mutated = coreText.replace('/\\r\\n?/g', '/\\r\\n/g');
    expect(mutated).not.toBe(coreText);
    expect(copyDifference(engineText, mutated)).toMatch(/^line \d+: /);
    expect(copyDifference(engineText, coreText.replace("'\\n'", "'\\r\\n'"))).not.toBeNull();
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

const source = (path: string): string => readFileSync(new URL(`../../packages/${path}`, import.meta.url), 'utf-8');

const SHARED = 'replay-core/src/team/item-damage-shared.ts';
const FIT = 'replay-core/src/spreads/fit.ts';
const CHOICE_LOCK = 'eval-engine/src/choice-lock.ts';

const DEFINITION = /^(?:export )?const OBSERVATION_SLACK = ([0-9.]+);$/m;

describe('OBSERVATION_SLACK', () => {

  test('the spread fit holds no definition of its own and imports the shared one', () => {
    const text = source(FIT);
    expect(text).not.toMatch(/\bconst OBSERVATION_SLACK\b/);
    expect(text).toMatch(/^import \{[^}]*\bOBSERVATION_SLACK\b[^}]*\} from '\.\.\/team\/item-damage-shared\.ts';$/m);
  });

  test('the Choice-lock check keeps a copy of the same value', () => {
    const shared = DEFINITION.exec(source(SHARED));
    const copy = DEFINITION.exec(source(CHOICE_LOCK));
    expect(shared).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(Number(copy![1])).toBe(Number(shared![1]));
  });
});
