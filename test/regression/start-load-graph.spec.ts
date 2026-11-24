import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BARRELS: Record<string, string> = {
  '@fulllifegames/replay-core': 'packages/replay-core/src/index.ts',
  '@fulllifegames/eval-engine': 'packages/eval-engine/src/index.ts',
};
const BATTLE_CLASSES = ['Battle', 'BattleStreams', 'Pokemon', 'Side'];
// Names whose origin module reaches a battle class only through a function the start load drops;
// a name joins once the build smoke passed.
const SHAKEN_OUT = new Set(['searchTreesOrchestrated']);
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

const read = (file: string) => readFileSync(file, 'utf8');

function resolveFile(from: string, spec: string): string | null {
  if (BARRELS[spec]) return join(ROOT, BARRELS[spec]);
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const extension of EXTENSIONS) {
    const path = base + extension;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

interface Import { names: string[]; spec: string }

function staticImports(source: string): Import[] {
  const found: Import[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s+from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    const names = (match[2] ?? '').replace(/\btype\s+\w+(\s+as\s+\w+)?/g, '').replace(/[{}*\n]/g, ' ')
      .split(',').map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    found.push({ names, spec: match[3] ?? match[4] });
  }
  return found;
}

function originsOfBarrel(barrel: string): Map<string, string> {
  const origins = new Map<string, string>();
  for (const { names, spec } of staticImports(read(barrel))) {
    const file = resolveFile(barrel, spec);
    if (file) for (const name of names) origins.set(name, file);
  }
  return origins;
}

function startLoad(): { files: Set<string>; takes: { file: string; spec: string; name: string }[] } {
  const entry = join(ROOT, 'src', 'main.tsx');
  const files = new Set([entry]);
  const queue = [entry];
  const takes: { file: string; spec: string; name: string }[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const inPackage = file.includes(`${join(ROOT, 'packages')}`);
    for (const { names, spec } of staticImports(read(file))) {
      if (!inPackage && BARRELS[spec]) for (const name of names) takes.push({ file, spec, name });
      const target = inPackage || !BARRELS[spec] ? resolveFile(file, spec) : null;
      if (target && !files.has(target)) { files.add(target); queue.push(target); }
    }
  }
  return { files, takes };
}

function battleCarrier(origin: string): string | null {
  const seen = new Set([origin]);
  const queue = [origin];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const { names, spec } of staticImports(read(file))) {
      if (spec === '@pkmn/sim' && names.some(imported => BATTLE_CLASSES.includes(imported))) return file;
      const target = resolveFile(file, spec);
      if (target && !BARRELS[spec] && !seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  return null;
}

describe('the start load takes nothing from a module that loads the battle runtime', () => {
  const { files, takes } = startLoad();
  const origins = new Map(Object.entries(BARRELS).map(([spec, barrel]) => [spec, originsOfBarrel(join(ROOT, barrel))]));

  test('the walk reaches the app', () => {
    expect(files.size).toBeGreaterThan(100);
    expect(takes.length).toBeGreaterThan(20);
  });

  test('every value the start page takes from a package barrel lives in a module that reaches no battle class of the simulator', () => {
    const heavy: string[] = [];
    for (const { file, spec, name } of takes) {
      const origin = origins.get(spec)?.get(name);
      if (!origin || SHAKEN_OUT.has(name)) continue;
      const carrier = battleCarrier(origin);
      if (carrier) heavy.push(`${relative(ROOT, file)} takes ${name} from ${relative(ROOT, origin)}, which reaches ${relative(ROOT, carrier)}`);
    }
    expect(heavy).toEqual([]);
  });
});
