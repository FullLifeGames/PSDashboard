// Regenerates eslint.ratchet.mjs, the size/complexity worklist.
//
// The ratchet has two layers: target values every file should meet, and a
// per-file pin for each legacy file that is still above a target. A pin sits
// at the file's current measured worst (line caps rounded up to the next 10
// so a small bugfix does not wedge), which means the file can only shrink.
// After refactoring, rerun this script: pins tighten or disappear. The script
// refuses to raise a pin or add a new one unless --allow-raise is passed,
// because a raise means a file grew past the gate.
//
// Usage: node scripts/update-lint-ratchet.mjs [--allow-raise]

import { ESLint } from 'eslint';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const RULES = ['max-lines', 'max-lines-per-function', 'complexity'];
const LINE_OPTS = { skipBlankLines: true, skipComments: true };

const SCOPES = [
  {
    files: ['src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    globs: ['src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    targets: { 'max-lines': 300, 'max-lines-per-function': 60, complexity: 15 },
  },
  {
    files: ['regression/**/*.ts', 'e2e/**/*.ts', 'e2e-feedback/**/*.ts', 'packages/*/test/**/*.ts'],
    globs: ['regression/**/*.ts', 'e2e/**/*.ts', 'e2e-feedback/**/*.ts', 'packages/*/test/**/*.ts'],
    targets: { 'max-lines': 600, 'max-lines-per-function': 300, complexity: 20 },
  },
];

function ruleEntry(rule, max) {
  if (rule === 'max-lines') return ['error', { max, ...LINE_OPTS }];
  if (rule === 'max-lines-per-function') return ['error', { max, ...LINE_OPTS, IIFEs: true }];
  return ['error', max];
}

function measureCap(rule, value) {
  // Line counts creep with any edit; give them headroom to the next 10.
  // Complexity only moves when branching changes, so pin it exactly.
  return rule === 'complexity' ? value : Math.ceil(value / 10) * 10;
}

async function measure() {
  const eslint = new ESLint({
    overrideConfig: SCOPES.map((scope) => ({
      files: scope.files,
      rules: Object.fromEntries(
        RULES.map((rule) => {
          const [, options] = ruleEntry(rule, scope.targets[rule]);
          return [rule, ['warn', options]];
        }),
      ),
    })),
  });
  const results = await eslint.lintFiles(SCOPES.flatMap((scope) => scope.globs));
  const worst = new Map();
  for (const result of results) {
    const rel = path.relative(process.cwd(), result.filePath).replaceAll('\\', '/');
    for (const message of result.messages) {
      if (!RULES.includes(message.ruleId)) continue;
      const match = message.message.match(/\((\d+)\)|complexity of (\d+)/);
      if (!match) continue;
      const value = Number(match[1] ?? match[2]);
      const entry = worst.get(rel) ?? {};
      entry[message.ruleId] = Math.max(entry[message.ruleId] ?? 0, value);
      worst.set(rel, entry);
    }
  }
  return worst;
}

async function loadExisting() {
  try {
    const url = pathToFileURL(path.resolve('eslint.ratchet.mjs'));
    const mod = await import(`${url.href}?t=${Date.now()}`);
    const caps = new Map();
    for (const override of mod.ratchetOverrides ?? []) {
      const file = override.files[0];
      const entry = {};
      for (const rule of RULES) {
        const config = override.rules[rule];
        if (!config) continue;
        entry[rule] = typeof config[1] === 'number' ? config[1] : config[1].max;
      }
      caps.set(file, entry);
    }
    return caps;
  } catch {
    return new Map();
  }
}

const allowRaise = process.argv.includes('--allow-raise');
const worst = await measure();
const existing = await loadExisting();

const raises = [];
const overrides = [];
for (const file of [...worst.keys()].sort()) {
  const entry = worst.get(file);
  const previous = existing.get(file);
  const rules = {};
  for (const rule of RULES) {
    if (entry[rule] === undefined) continue;
    let cap = measureCap(rule, entry[rule]);
    const oldCap = previous?.[rule];
    if (oldCap !== undefined && cap > oldCap) {
      raises.push(`${file}: ${rule} ${oldCap} -> ${cap}`);
      if (!allowRaise) cap = oldCap;
    } else if (oldCap === undefined && previous !== undefined) {
      raises.push(`${file}: ${rule} newly over target (${entry[rule]})`);
    } else if (previous === undefined && existing.size > 0) {
      raises.push(`${file}: new pin (${rule} ${entry[rule]})`);
    }
    rules[rule] = ruleEntry(rule, cap);
  }
  overrides.push({ files: [file], rules });
}

if (raises.length > 0 && !allowRaise) {
  console.error('Refusing to loosen the ratchet. These files grew past their pins:');
  for (const raise of raises) console.error(`  ${raise}`);
  console.error('Shrink the files instead, or rerun with --allow-raise for a conscious exception.');
  process.exit(1);
}

const base = SCOPES.map((scope) => ({
  files: scope.files,
  rules: Object.fromEntries(RULES.map((rule) => [rule, ruleEntry(rule, scope.targets[rule])])),
}));

const removed = [...existing.keys()].filter((file) => !worst.has(file));
const banner = `// GENERATED FILE - regenerate with \`node scripts/update-lint-ratchet.mjs\`.
//
// Size and complexity ceilings. \`ratchetBase\` holds the target values every
// file should meet. \`ratchetOverrides\` is the refactor worklist: each entry
// pins a legacy file at its current measured worst, so the file can only
// shrink. Refactor a file below its pin, rerun the script, and the pin
// tightens or disappears. The script refuses to raise a pin.
`;
const body = `${banner}
export const ratchetBase = ${JSON.stringify(base, null, 2)};

export const ratchetOverrides = ${JSON.stringify(overrides, null, 2)};
`;
writeFileSync('eslint.ratchet.mjs', body);
console.log(`eslint.ratchet.mjs written: ${overrides.length} pinned files, ${removed.length} pins released.`);
for (const file of removed) console.log(`  released: ${file}`);
if (allowRaise && raises.length > 0) {
  console.log('Raised with --allow-raise:');
  for (const raise of raises) console.log(`  ${raise}`);
}
