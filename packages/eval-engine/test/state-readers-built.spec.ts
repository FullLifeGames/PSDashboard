import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';
import { censusOf, type Census } from './state-readers-built-entry';

// The Dex entries are those of the bundle's own copy of @pkmn/sim.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ENTRY = fileURLToPath(new URL('./state-readers-built-entry.ts', import.meta.url));

async function builtCensus(plugins: Plugin[] = []): Promise<Census> {
  const result = await build({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    plugins,
    build: { write: false, reportCompressedSize: false, rolldownOptions: { input: ENTRY, preserveEntrySignatures: 'strict' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(one => ('output' in one ? one.output : []));
  const chunk = outputs.find(output => output.type === 'chunk' && output.isEntry);
  if (!chunk || chunk.type !== 'chunk') throw new Error('the build made no entry chunk');
  const folder = mkdtempSync(join(tmpdir(), 'state-readers-built-'));
  try {
    const file = join(folder, 'built.mjs');
    writeFileSync(file, chunk.code);
    const built = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { censusOf: () => Census };
    return built.censusOf();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function differences(node: Census, built: Census): string[] {
  const out: string[] = [];
  for (const key of new Set([...Object.keys(node), ...Object.keys(built)])) {
    const left = node[key]?.join(',') ?? '(missing)';
    const right = built[key]?.join(',') ?? '(missing)';
    if (left !== right) out.push(`${key}: node [${left}] built [${right}]`);
  }
  return out;
}

const renameProperty = (from: string, to: string): Plugin => ({
  name: 'rename-property',
  enforce: 'pre',
  transform(code, id) {
    if (!/@pkmn[\\/]sim/.test(id) || !code.includes(from)) return null;
    return code.replaceAll(new RegExp(`\\b${from}\\b`, 'g'), to);
  },
});

describe('the scan of the Dex handlers reads the same in the production build as in Node', () => {
  const node = censusOf();

  test('the census is not empty: every generation, the Champions mod, the methods and both consumers', () => {
    const keys = Object.keys(node);
    expect(keys.length).toBeGreaterThan(10_000);
    for (const label of ['gen1', 'gen4', 'gen9', 'champions']) expect(keys.some(key => key.startsWith(`${label}|moves|`))).toBe(true);
    expect(keys.some(key => key.startsWith('methods|'))).toBe(true);
    expect(keys.some(key => key.includes('|hit:fields'))).toBe(true);
    expect(keys.some(key => key.includes('|residual:fields'))).toBe(true);
    expect(keys.filter(key => key.includes('|source:')).length).toBeGreaterThan(5_000);
  });

  test('per entry, per handler, per consumer and per method, the built bundle finds what Node finds', async () => {
    const built = await builtCensus();
    expect(Object.keys(built).length).toBe(Object.keys(node).length);
    const diff = differences(node, built);
    expect(diff.slice(0, 20), `${diff.length} differences`).toEqual([]);
  }, 300_000);

  test('a build that renames a property the handlers read is seen (the comparison has teeth)', async () => {
    const mangled = await builtCensus([renameProperty('effectState', 'effectStateRenamed')]);
    const diff = differences(node, mangled);
    expect(diff.length).toBeGreaterThan(100);
    expect(diff.some(line => line.includes('residual:fields'))).toBe(true);
  }, 300_000);
});
