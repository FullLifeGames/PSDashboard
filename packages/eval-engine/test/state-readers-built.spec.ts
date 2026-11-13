import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';
import { censusOf, type Census } from './state-readers-built-entry';

/**
 * Round 89 (#149, decision 1a): the board key's table of readers comes from `String(handler)` of the simulator's Dex, in the
 * app's own realm (the main thread, the eval workers), which runs the PRODUCTION BUILD of the simulator. A build can rewrite a
 * handler's source (a minifier that renames properties, folds a branch or inlines a call), and then the browser would key other
 * fields than Node does, and the hit memo and the end-of-turn memo would answer for boards they should keep apart, or split
 * boards that are one. This spec builds `test/regressio./state-readers-built-entry.ts` with the app's own Vite
 * configuration (vite.config.ts: its minifier, its target, its resolve rules, `keepNames`) and runs the bundle in Node next to
 * the source: per Dex entry of Generations 1 to 9 and of the Champions mod, per handler (the event) and per consumer (the hit,
 * the end of the turn), the properties the scan finds, the ids it names, and the reads of the simulator's methods must be the
 * same. The Dex entries are those of the bundle's own copy of @pkmn/sim, which is the copy of the source run.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ENTRY = fileURLToPath(new URL('./state-readers-built-entry.ts', import.meta.url));

/** The census of the entry bundled with the app's build settings; `plugins` are extra, for the control that a rewriting build is seen. */
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

/** The keys whose values differ between the two censuses (a key on one side only counts), as `key: node [..] built [..]`. */
function differences(node: Census, built: Census): string[] {
  const out: string[] = [];
  for (const key of new Set([...Object.keys(node), ...Object.keys(built)])) {
    const left = node[key]?.join(',') ?? '(missing)';
    const right = built[key]?.join(',') ?? '(missing)';
    if (left !== right) out.push(`${key}: node [${left}] built [${right}]`);
  }
  return out;
}

/** A build that renames one property wherever it appears: what a property-mangling minifier does to a handler's source. */
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
