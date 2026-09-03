import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as replayCore from '../packages/replay-core/src/index';
import * as evalEngine from '../packages/eval-engine/src/index';

/**
 * The public surface of each workspace package, pinned twice: the names the
 * compiler sees on the barrel (values and types) against a committed
 * snapshot, and the names Node sees at runtime against the snapshot's value
 * lines. Widening or narrowing a barrel is a deliberate act: edit
 * `packages/<name>/src/index.ts`, rerun with `UPDATE_API_SNAPSHOT=1`, and
 * review the fixture diff.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = [
  { name: 'replay-core', runtime: replayCore },
  { name: 'eval-engine', runtime: evalEngine },
] as const;

const fixturePath = (name: string) => resolve(repoRoot, 'regression/fixtures/api', `${name}.txt`);

/** `value name` / `type name` lines, sorted, for everything the barrel exports. */
function compilerSurface(name: string): string[] {
  const dir = resolve(repoRoot, 'packages', name);
  const config = ts.readConfigFile(resolve(dir, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const barrelFile = parsed.fileNames.find(file => file.endsWith('/src/index.ts'));
  const barrel = barrelFile ? program.getSourceFile(barrelFile) : undefined;
  if (!barrel) throw new Error(`${name}: src/index.ts is not part of the package project`);
  const moduleSymbol = checker.getSymbolAtLocation(barrel);
  if (!moduleSymbol) throw new Error(`${name}: the barrel has no module symbol`);
  return checker.getExportsOfModule(moduleSymbol)
    .map(symbol => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return `${target.flags & ts.SymbolFlags.Value ? 'value' : 'type'} ${symbol.name}`;
    })
    .sort();
}

test.describe('Package API surface', () => {
  for (const { name, runtime } of PACKAGES) {
    test(`${name}: the barrel matches the pinned surface`, () => {
      const actual = compilerSurface(name).join('\n') + '\n';
      const path = fixturePath(name);
      if (process.env.UPDATE_API_SNAPSHOT) writeFileSync(path, actual);
      expect(existsSync(path), `missing ${path}; run with UPDATE_API_SNAPSHOT=1 to create it`).toBe(true);
      expect(actual).toBe(readFileSync(path, 'utf8'));
    });

    test(`${name}: the runtime exports match the pinned values`, () => {
      const pinnedValues = readFileSync(fixturePath(name), 'utf8')
        .split('\n')
        .filter(line => line.startsWith('value '))
        .map(line => line.slice('value '.length))
        .sort();
      expect(Object.keys(runtime).sort()).toEqual(pinnedValues);
    });
  }
});
