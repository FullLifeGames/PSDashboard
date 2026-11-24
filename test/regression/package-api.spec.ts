import { test, expect, describe } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as replayCore from '@fulllifegames/replay-core';
import * as evalEngine from '@fulllifegames/eval-engine';
import { PKMN_EXACT } from '../../scripts/upgrade-pkmn.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGES = [
  { name: 'replay-core', runtime: replayCore },
  { name: 'eval-engine', runtime: evalEngine },
] as const;

const fixturePath = (name: string) => resolve(repoRoot, 'test/regression/fixtures/api', `${name}.txt`);

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

interface Manifest {
  name: string;
  version: string;
  license: string;
  type: string;
  sideEffects: boolean;
  exports: { '.': Record<string, string> };
  files: string[];
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('Package hygiene', () => {
  const rootLicense = readFileSync(resolve(repoRoot, 'LICENSE'), 'utf8');
  const rootVersion = readJson<{ version: string }>(resolve(repoRoot, 'package.json')).version;
  const examples: Record<string, string> = { 'replay-core': 'parse-replay.mjs', 'eval-engine': 'evaluate-turn.mjs' };

  for (const { name } of PACKAGES) {
    const dir = resolve(repoRoot, 'packages', name);

    test(`${name}: the manifest is ready to publish`, () => {
      const manifest = readJson<Manifest>(resolve(dir, 'package.json'));
      expect(manifest.name).toBe(`@fulllifegames/${name}`);
      expect(manifest.version, 'move all three: npm version <bump> --workspaces --include-workspace-root --no-git-tag-version')
        .toBe(rootVersion);
      expect(manifest.license).toBe('MIT');
      expect(manifest.type).toBe('module');
      expect(manifest.sideEffects).toBe(false);
      expect(manifest.publishConfig?.access).toBe('public');
      expect(Object.keys(manifest.exports['.'])).toEqual(['types', 'default']);
      if (name === 'eval-engine') {
        expect(manifest.files).toEqual(['dist', 'bin', 'samples', 'README.md']);
        // The path as npm writes it: npm 12 drops the leading ./ and warns the entry invalid.
        expect((manifest as Manifest & { bin?: Record<string, string> }).bin).toEqual({ 'eval-engine': 'bin/eval-engine.mjs' });
      } else {
        expect(manifest.files).toEqual(['dist', 'README.md']);
      }
      for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
        expect(dep.startsWith('@fulllifegames/'), `${dep} is not a workspace package`).toBe(true);
        expect(range).toBe('*');
      }
      for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
        expect(range, dep).toMatch(PKMN_EXACT.includes(dep) ? /^\d+\.\d+\.\d+$/ : /^\^\d/);
      }
    });

    test(`${name}: LICENSE is the repository license`, () => {
      expect(readFileSync(resolve(dir, 'LICENSE'), 'utf8')).toBe(rootLicense);
    });

    test(`${name}: the README carries the example verbatim`, () => {
      const lf = (text: string) => text.replace(/\r\n/g, '\n');
      const example = lf(readFileSync(resolve(dir, 'examples', examples[name]), 'utf8'));
      const readme = lf(readFileSync(resolve(dir, 'README.md'), 'utf8'));
      expect(readme).toContain('```js\n' + example + '```');
      expect(readme).toContain(`examples/${examples[name]}`);
    });
  }
});

describe('Package API surface', () => {
  // A Windows checkout may hand the pin back with CRLF endings; the surface is compared line by line, not byte by byte.
  const pinned = (name: string) => readFileSync(fixturePath(name), 'utf8').replace(/\r\n/g, '\n');
  for (const { name, runtime } of PACKAGES) {
    test(`${name}: the barrel matches the pinned surface`, () => {
      const actual = compilerSurface(name).join('\n') + '\n';
      const path = fixturePath(name);
      if (process.env.UPDATE_API_SNAPSHOT) writeFileSync(path, actual);
      expect(existsSync(path), `missing ${path}; run with UPDATE_API_SNAPSHOT=1 to create it`).toBe(true);
      expect(actual).toBe(pinned(name));
    });

    test(`${name}: the runtime exports match the pinned values`, () => {
      const pinnedValues = pinned(name)
        .split('\n')
        .filter(line => line.startsWith('value '))
        .map(line => line.slice('value '.length))
        .sort();
      expect(Object.keys(runtime).sort()).toEqual(pinnedValues);
    });
  }
});
