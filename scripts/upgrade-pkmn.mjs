// Moves the @pkmn release train to one version in every workspace manifest (round 70, T43).
//
//   node scripts/upgrade-pkmn.mjs [version] [--dry-run]      (npm run upgrade:pkmn -- [version])
//
// eval-engine's speed layer copies classes of one @pkmn/sim version and checks no hash in the browser, so
// @pkmn/sim and @pkmn/mods stay pinned exactly; @pkmn/dex and @pkmn/data follow the same release as ^version.
// Without a version the registry's latest @pkmn/sim is taken. The script rewrites the manifests, runs
// npm install and prints the checks a simulator change needs before it ships; --dry-run prints the plan only.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const MANIFESTS = ['package.json', 'packages/eval-engine/package.json', 'packages/replay-core/package.json'];
export const PKMN_EXACT = ['@pkmn/sim', '@pkmn/mods'];
export const PKMN_TRAIN = ['@pkmn/dex', '@pkmn/data'];
const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies'];

/** The manifest with the train moved to `version`; the input stays as it is. */
export function planPkmnUpgrade(manifest, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`upgrade-pkmn: ${version} is no plain release (x.y.z)`);
  const next = structuredClone(manifest);
  for (const section of SECTIONS) {
    const deps = next[section];
    if (!deps) continue;
    for (const name of PKMN_EXACT) if (deps[name] !== undefined) deps[name] = version;
    for (const name of PKMN_TRAIN) if (deps[name] !== undefined) deps[name] = `^${version}`;
  }
  return next;
}

// Fixed command lines through the shell (npm is a .cmd on Windows); no argument from outside reaches them.
const npmInstall = () => spawnSync('npm install', { cwd: ROOT, stdio: 'inherit', shell: true });
const latestSim = () => execSync('npm view @pkmn/sim version', { cwd: ROOT, encoding: 'utf8' }).trim();

function changesOf(before, after) {
  return SECTIONS.flatMap(section => Object.keys(after[section] ?? {})
    .filter(name => after[section][name] !== before[section][name])
    .map(name => `${section}.${name} ${before[section][name]} -> ${after[section][name]}`));
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const version = argv.find(arg => !arg.startsWith('--')) ?? latestSim();
  let touched = 0;
  for (const path of MANIFESTS) {
    const file = join(ROOT, path);
    const before = JSON.parse(readFileSync(file, 'utf8'));
    const after = planPkmnUpgrade(before, version);
    const changes = changesOf(before, after);
    console.log(`${path}: ${changes.length > 0 ? changes.join(', ') : 'unchanged'}`);
    if (!dryRun && changes.length > 0) {
      writeFileSync(file, JSON.stringify(after, null, 2) + '\n');
      touched += 1;
    }
  }
  if (dryRun) return;
  if (touched > 0) {
    const install = npmInstall();
    if (install.status !== 0) {
      process.exitCode = install.status ?? 1;
      return;
    }
  }
  console.log([
    '',
    `The @pkmn train stands at ${version}. Before a new simulator ships:`,
    '- T103 (docs/backlog.md): harden the speed layer for it (hash gate, census over Gen 1 to 9).',
    '- npx vitest run --project eval-engine, also with EVAL_SIM_FAST=0 and EVAL_SIM_FAST=1 (the CI modes).',
    '- the batch check of AGENTS.md: a new simulator can move every score, so a feedback run and the paired bank.',
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
