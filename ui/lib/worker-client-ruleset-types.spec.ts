import path from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

/**
 * Round 69 (T184): the rule set is a required field of the settings the app
 * hands the pool and of the two sweep param types. The specs are not part of
 * `tsc -b`, so this test compiles probe snippets against the app's own
 * tsconfig and reads the diagnostics: a caller without a rule set must stop
 * compiling, a caller with one must compile.
 */
const root = path.resolve(__dirname, '../..');
const virtual = path.join(root, 'src/__ruleset_probe__.ts');

function diagnosticsOf(snippet: string): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.app.json'), { noEmit: true }, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!config) throw new Error('tsconfig.app.json did not parse');
  const host = ts.createCompilerHost(config.options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (file) => path.resolve(file) === virtual || fileExists(file);
  host.readFile = (file) => (path.resolve(file) === virtual ? snippet : readFile(file));
  host.getSourceFile = (file, ...rest) =>
    path.resolve(file) === virtual ? ts.createSourceFile(file, snippet, config.options.target ?? ts.ScriptTarget.ES2023) : getSourceFile(file, ...rest);
  const program = ts.createProgram([virtual], config.options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(virtual)).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const PREFIX = `
import type { EvalWorkerClient } from './lib/eval/worker-client';
import type { GraphSweepParams } from './hooks/evaluation/sweep-types';
import type { EvaluateParams } from './hooks/evaluation/single-eval';
declare const client: EvalWorkerClient;
export type Used = [GraphSweepParams, EvaluateParams];
`;

describe('the rule set is a required field', () => {
  test('evaluate and evalPair compile with a rule set and refuse settings without one', () => {
    expect(diagnosticsOf(`${PREFIX}
void client.evaluate('{}', { depth: 1, samples: 1, ruleset: 'standard' });
void client.evalPair('{}', 'move 1', 'move 1', { depth: 1, samples: 1, ruleset: 'champions' });`)).toEqual([]);
    const missing = diagnosticsOf(`${PREFIX}
void client.evaluate('{}', { depth: 1, samples: 1 });
void client.evalPair('{}', 'move 1', 'move 1', { depth: 2, samples: 1, mode: 'mcts' });`);
    expect(missing).toHaveLength(2);
    expect(missing.every(message => /ruleset/.test(message))).toBe(true);
  }, 120_000);

  test('the sweep and single-evaluation params require a rule set', () => {
    const missing = diagnosticsOf(`${PREFIX}
type Without<T> = Omit<T, 'ruleset'>;
declare const sweep: Without<GraphSweepParams>;
declare const single: Without<EvaluateParams>;
export const a: GraphSweepParams = sweep;
export const b: EvaluateParams = single;`);
    expect(missing).toHaveLength(2);
    expect(missing.every(message => /ruleset/.test(message))).toBe(true);
  }, 120_000);
});
