/**
 * Installs the packed workspace packages into a throwaway Node project and
 * runs the README examples there, the way a consumer would.
 *
 *   npm run pack:smoke            # or: node scripts/pack-smoke.mjs [--keep]
 *
 * Steps: publish-packages.mjs packs every package with the release manifest
 * (version synced, caret ranges); a consumer project installs the tarballs
 * plus the sim family linked from this repository's node_modules (no
 * registry); both examples run against the fixture replay; a NodeNext
 * TypeScript consumer type-checks against the shipped declarations. --keep
 * leaves the temp directory behind for inspection.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PEERS = ['@pkmn/sim', '@pkmn/dex', '@pkmn/data', '@pkmn/client', '@smogon/calc'];
const EXAMPLES = [
  { pkg: 'eval-engine', file: 'evaluate-turn.mjs', args: ['2'], expect: /^Turn 2: TestPlayer1 wins \d+% of the time$/m },
  { pkg: 'replay-core', file: 'parse-replay.mjs', args: [], expect: /^4 turn snapshots; at turn 4 /m },
];
const CHECK_TS = `import { parseReplayLog, type TurnSnapshot } from '@fulllifegames/replay-core';
import { searchPosition, winPercent, type EvalResult, type EvalSettings } from '@fulllifegames/eval-engine';

const settings: EvalSettings = { depth: 1, samples: 1 };
// @ts-expect-error depth is 1 | 2 | 3 (this line fails as unused if EvalSettings resolved to any)
const wrong: EvalSettings = { depth: 4, samples: 1 };
const snapshots: TurnSnapshot[] = parseReplayLog('');
const evaluate = (serialized: string): EvalResult => searchPosition(serialized, settings);
export { evaluate, snapshots, wrong, winPercent };
`;
const CHECK_TSCONFIG = {
  compilerOptions: {
    module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023', lib: ['ES2023'], types: [],
    strict: true, noEmit: true, skipLibCheck: true,
  },
  files: ['check.ts'],
};

const root = process.cwd();
const keep = process.argv.includes('--keep');
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

/** npm is a .cmd shim on Windows, which Node only runs through a shell; everything else spawns directly. */
const quote = arg => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

function run(command, args, options = {}) {
  const result = command === 'npm' && process.platform === 'win32'
    ? spawnSync([command, ...args].map(quote).join(' '), { encoding: 'utf8', shell: true, ...options })
    : spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

const tmp = mkdtempSync(join(tmpdir(), 'ps-dashboard-pack-'));
const tarballDir = join(tmp, 'tarballs');
const consumer = join(tmp, 'consumer');
console.log(`smoke directory ${tmp}`);
try {
  run('node', ['scripts/publish-packages.mjs', '--pack', tarballDir, '--all'], { stdio: 'inherit' });
  const tarballs = readdirSync(tarballDir).filter(name => name.endsWith('.tgz')).map(name => join(tarballDir, name));
  if (tarballs.length !== 2) throw new Error(`expected two tarballs, found ${tarballs.length}`);
  console.log(`[${elapsed()}] packed ${tarballs.map(file => file.split(/[\\/]/).at(-1)).join(', ')}`);

  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'pack-smoke-consumer', private: true, type: 'module' }, null, 2) + '\n');
  const peerDirs = PEERS.map(name => resolve(root, 'node_modules', name));
  // --install-links=false links the peers instead of copying them (their own
  // dependencies then resolve from this repository); --ignore-scripts skips
  // the peers' monorepo prepare scripts, which cannot run outside their tree.
  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', '--install-links=false', '--ignore-scripts', ...tarballs, ...peerDirs], { cwd: consumer, stdio: 'inherit' });
  const installed = readFileSync(join(consumer, 'node_modules/@fulllifegames/eval-engine/package.json'), 'utf8');
  const manifest = JSON.parse(installed);
  if (manifest.dependencies['@fulllifegames/replay-core'] === '*') throw new Error('the tarball still carries the workspace "*" reference');
  console.log(`[${elapsed()}] installed ${manifest.name}@${manifest.version} (replay-core ${manifest.dependencies['@fulllifegames/replay-core']})`);

  const fixture = resolve(root, 'e2e/fixtures/replay.json');
  for (const example of EXAMPLES) {
    copyFileSync(resolve(root, 'packages', example.pkg, 'examples', example.file), join(consumer, example.file));
    const output = run('node', [example.file, fixture, ...example.args], { cwd: consumer });
    if (!example.expect.test(output)) throw new Error(`${example.file}: unexpected output\n${output}`);
    console.log(`[${elapsed()}] ${example.file} ok: ${output.split('\n')[0]}`);
  }

  writeFileSync(join(consumer, 'check.ts'), CHECK_TS);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(CHECK_TSCONFIG, null, 2) + '\n');
  run('node', [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], { stdio: 'inherit' });
  console.log(`[${elapsed()}] NodeNext consumer type-checks against the shipped declarations`);
  console.log('pack smoke passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (keep || process.exitCode) console.log(`kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}
