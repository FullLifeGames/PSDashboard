import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the win-path job and the analysis', () => {
  test('no file of the sweep names the job', () => {
    const offenders = sources(join(ROOT, 'src', 'hooks', 'evaluation')).filter(path => /winPaths|WinPaths|runOnRequestJob/.test(readFileSync(path, 'utf-8')));
    expect(offenders.map(path => relative(ROOT, path))).toEqual([]);
  });

  test('the client\'s winPaths has one caller outside the client: the panel\'s hook', () => {
    const callers = sources(join(ROOT, 'src'))
      .filter(path => !relative(join(ROOT, 'src'), path).startsWith(join('lib', 'eval')))
      .filter(path => /\.winPaths\(/.test(readFileSync(path, 'utf-8')));
    expect(callers.map(path => relative(ROOT, path).replace(/\\/g, '/'))).toEqual(['src/hooks/useWinPaths.ts']);
  });

  test('the engine package runs the job from the worker alone', () => {
    const callers = sources(join(ROOT, 'src'))
      .filter(path => /runOnRequestJob\(/.test(readFileSync(path, 'utf-8')));
    expect(callers.map(path => relative(ROOT, path).replace(/\\/g, '/'))).toEqual(['src/workers/eval-worker.ts']);
  });
});
