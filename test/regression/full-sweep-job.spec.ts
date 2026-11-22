import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Round 89 (final gate, D6b): every spec that reads the full-sweep switch runs with `DICE_SWEEPS=full` in one of two CI jobs of
 * test.yml: "Dice sweeps, every move" (the eval-engine specs whose path matches the job's pattern) or "Full sweeps, the other
 * specs" (an explicit list in three parts). In round 89 three specs failed only under the switch and stayed red for days because
 * the dice job's pattern reaches `dice-*` files only; 29 sweep specs never ran full in CI (D9b split two of them into five parts of about 1,500 seconds each: the list names 36 files now). This spec holds the lists to the
 * truth: a spec that reads the switch and sits in neither job fails here, a listed file that no longer exists fails here, and a
 * spec that sits in both runs twice.
 *
 * What counts as a reader: a spec that names `SWEEPS_FULL`, `sweepSelection` or `sweepMoves` (all three come from
 * `dice-fixtures.ts` or its `dice-sweep-support.ts`), or reads `process.env.DICE_SWEEPS` itself; or a spec that imports, by name,
 * something that a support module builds from one of them (`sweepItems`, `witnessesWanted`, `swept`). A spec that imports a
 * support module only for its helpers is no reader. Comments do not count.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf8').split(/\r?\n/);
const SELF = 'test/regression/full-sweep-job.spec.ts';
const SWITCH = /\b(?:SWEEPS_FULL|sweepSelection|sweepMoves)\b|process\.env\.DICE_SWEEPS\b/;
const SPEC_DIRS = ['packages/eval-engine/test', 'packages/replay-core/test', 'test/regression'];
/** The module that defines the switch: importing it for `mon` or `RULES` reads nothing. */
const DEFINITION = 'packages/eval-engine/test/dice-fixtures.ts';

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** The lines of one job of test.yml: from its key at two spaces of indent to the next key at the same indent. */
function jobLines(key: string): string[] {
  const start = WORKFLOW.findIndex(line => line === `  ${key}:`);
  if (start < 0) return [];
  const length = WORKFLOW.slice(start + 1).findIndex(line => /^ {2}\S/.test(line) && !line.startsWith('  #'));
  return WORKFLOW.slice(start, length < 0 ? undefined : start + 1 + length);
}

const files = SPEC_DIRS.flatMap(dir => readdirSync(join(ROOT, dir)).filter(name => name.endsWith('.ts')).map(name => `${dir}/${name}`));
const source = new Map(files.map(file => [file, withoutComments(readFileSync(join(ROOT, file), 'utf8'))]));
const isSpec = (file: string): boolean => file.endsWith('.spec.ts');
const reads = (file: string): boolean => file !== SELF && file !== DEFINITION && SWITCH.test(source.get(file) ?? '');

/** Splits a module at its top-level declarations: the names it exports whose declaration reads the switch, directly or through a declaration of the same module. */
function switchExports(file: string): Set<string> {
  const chunks = (source.get(file) ?? '').split(/\n(?=(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s)/).map(text => ({
    text,
    name: /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+(\w+)/.exec(text)?.[1],
    exported: /^export\s/.test(text),
  }));
  const tainted = new Set(chunks.filter(chunk => chunk.name && SWITCH.test(chunk.text)).map(chunk => chunk.name as string));
  for (let grew = true; grew;) {
    grew = false;
    for (const chunk of chunks) {
      if (!chunk.name || tainted.has(chunk.name)) continue;
      if ([...tainted].some(name => new RegExp(`\\b${name}\\b`).test(chunk.text))) { tainted.add(chunk.name); grew = true; }
    }
  }
  return new Set(chunks.filter(chunk => chunk.exported && chunk.name && tainted.has(chunk.name)).map(chunk => chunk.name as string));
}

const supportExports = new Map(files.filter(file => !isSpec(file) && file !== DEFINITION && reads(file)).map(file => [file, switchExports(file)]));

/** The named imports of a spec from a relative module, as repository paths. */
function namedImports(file: string): { from: string; names: string[] }[] {
  return [...(source.get(file) ?? '').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']*)'/g)].map(match => ({
    from: resolve(dirname(join(ROOT, file)), `${match[2]}.ts`).slice(ROOT.length),
    names: match[1].split(',').map(name => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean),
  }));
}

const readers = files.filter(file => isSpec(file) && (reads(file) ||
  namedImports(file).some(({ from, names }) => names.some(name => supportExports.get(from)?.has(name))))).sort();

/** The eval-engine specs the dice job runs: its vitest command names a path pattern. */
const dicePattern = /npx vitest run --project eval-engine (\S+)/.exec(jobLines('dice-sweeps').join('\n'))?.[1] ?? '';
const diceSpecs = files.filter(file => isSpec(file) && file.startsWith('packages/eval-engine/test/') && dicePattern !== '' && file.includes(dicePattern));

/** The specs the second job names, per part of its matrix, in the order of the file. */
const otherLines = jobLines('full-sweeps');
const otherParts = otherLines.join('\n').split(/- part:/).slice(1).map(part => part.match(/[\w./-]+\.spec\.ts/g) ?? []);
const otherSpecs = otherParts.flat();

describe('the two CI jobs that run the specs with DICE_SWEEPS=full', () => {
  test('the dice job names a path pattern and the other job exists with three parts', () => {
    expect(dicePattern).toBe('packages/eval-engine/test/dice-');
    expect(otherParts).toHaveLength(3);
    expect(otherParts.every(part => part.length > 0)).toBe(true);
  });

  test('both jobs set DICE_SWEEPS to full', () => {
    expect(jobLines('dice-sweeps').join('\n')).toMatch(/DICE_SWEEPS:\s*full/);
    expect(otherLines.join('\n')).toMatch(/DICE_SWEEPS:\s*full/);
  });

  test('every spec that reads the switch runs in one of the two jobs', () => {
    const missing = readers.filter(file => !diceSpecs.includes(file) && !otherSpecs.includes(file));
    expect(missing, `these specs read the full-sweep switch and run in neither job; add them to a part of "Full sweeps, the other specs" in .github/workflows/test.yml`).toEqual([]);
  });

  test('every listed file exists, is a spec and reads the switch', () => {
    expect(otherSpecs.filter(file => !existsSync(join(ROOT, file))), 'listed files that no longer exist').toEqual([]);
    expect(otherSpecs.filter(file => !readers.includes(file)), 'listed specs that read no switch (they run full for nothing)').toEqual([]);
  });

  test('no spec runs in both jobs or twice in the second one', () => {
    expect(otherSpecs.filter(file => diceSpecs.includes(file)), 'in the dice job already').toEqual([]);
    expect(otherSpecs.filter((file, index) => otherSpecs.indexOf(file) !== index), 'listed twice').toEqual([]);
  });

  test('the reading finds the sweeps it is known to find', () => {
    // Guards the scan itself: if it stops finding these, an empty list would pass the rows above.
    expect(readers).toContain('packages/eval-engine/test/board-key-readers.spec.ts');
    expect(readers).toContain('packages/eval-engine/test/dice-logged-sweep.spec.ts');
    // the five parts of the logged sweep (D9b): the support module they share is read through its exports
    for (const part of ['sweep', 'crit-doubles-a', 'crit-doubles-b', 'crit-singles', 'secondary']) {
      expect(readers).toContain(part === 'sweep' ? 'packages/eval-engine/test/dice-logged-sweep.spec.ts' : `packages/eval-engine/test/dice-logged-${part}.spec.ts`);
    }
    // the sweeps D9b split by realm: every part reads the switch through its body module
    for (const part of ['landed-hit-sweep', 'landed-hit-sweep-2', 'landed-hit-sweep-3', 'blocked-effects-sweep', 'blocked-effects-sweep-2']) {
      expect(readers).toContain(`packages/replay-core/test/${part}.spec.ts`);
    }
    expect(readers).not.toContain('test/regression/upgrade-checks-dice.spec.ts');
    expect(readers.length).toBeGreaterThan(50);
  });
});

describe('the job names that branch protection reads', () => {
  const names = WORKFLOW.map(line => /^ {4}name:\s*(.+)$/.exec(line)?.[1]).filter((name): name is string => name !== undefined);

  // The five required checks plus the engine job's second matrix entry give the six contexts; GitHub matches a check by its whole name.
  // "Browser flows" is the aggregate job of the three parts (round 90, E6; browser-flows-parts.spec.ts holds it); the parts and the sweep parts are no required checks.
  test('the six required checks keep their names, and the jobs in parts take none of them', () => {
    const parts = ['Full sweeps, the other specs, part ${{ matrix.part }} of 3', 'Browser flows, part ${{ matrix.part }} of 3'];
    for (const added of parts) expect(names.filter(name => name === added)).toHaveLength(1);
    expect(names.filter(name => !parts.includes(name))).toEqual([
      'Node suites',
      'Engine suite, speed layer ${{ matrix.speed-layer }}',
      'Dice sweeps, every move',
      'Browser flows',
      'Production build smoke',
    ]);
  });
});
