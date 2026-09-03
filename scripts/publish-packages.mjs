/**
 * Publishes the workspace packages (packages/*) as part of the release flow.
 *
 * One global version: the root package.json version is written into every
 * package manifest while this script runs. Changed-only: a package is
 * selected when its files changed since the previous release tag (the newest
 * v* tag below the current version), when no earlier tag exists, or when the
 * registry has no version of it yet. The workspace reference "*" on the
 * sibling package becomes a caret range on the version being published, or
 * on the latest published version when the sibling is skipped this round.
 * The manifests are restored afterwards, whatever happens in between.
 *
 *   node scripts/publish-packages.mjs --dry-run           # the plan plus npm pack --dry-run, nothing uploaded
 *   node scripts/publish-packages.mjs --pack <dir> --all  # tarballs for every package (the pack smoke)
 *   node scripts/publish-packages.mjs                     # publish the selected packages (release.yml)
 *
 * --registry-latest <name>=<version> answers "what is on npm" without the
 * network (tests, air-gapped dry runs). Runs from the repository root; the
 * publish itself expects npm to be authenticated (NODE_AUTH_TOKEN in CI).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Dependency order: a package comes after the packages it depends on. */
const PACKAGES = ['replay-core', 'eval-engine'];
const SCOPE = '@fulllifegames';

const args = process.argv.slice(2);
const has = name => args.includes(name);
const valueOf = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const dryRun = has('--dry-run');
const packDir = valueOf('--pack') ? resolve(valueOf('--pack')) : null;
const all = has('--all');
const registryOverrides = new Map(
  args.flatMap((arg, index) => (arg === '--registry-latest' ? [args[index + 1].split('=')] : [])),
);

const root = process.cwd();
if (!existsSync(resolve(root, 'packages')) || !existsSync(resolve(root, 'package.json'))) {
  console.error('run this script from the repository root');
  process.exit(2);
}

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
/** npm is a .cmd shim on Windows, which Node only runs through a shell; everything else spawns directly. */
const quote = arg => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
const run = (command, commandArgs, options = {}) =>
  command === 'npm' && process.platform === 'win32'
    ? spawnSync([command, ...commandArgs].map(quote).join(' '), { encoding: 'utf8', shell: true, ...options })
    : spawnSync(command, commandArgs, { encoding: 'utf8', ...options });
const git = (...gitArgs) => {
  const result = run('git', gitArgs);
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const parseVersion = text => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? match.slice(1, 4).map(Number) : null;
};
const lower = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** The newest v* tag whose version is below the one being released, or null. */
function previousReleaseTag(version) {
  const current = parseVersion(version);
  if (!current) throw new Error(`root version ${version} is not major.minor.patch`);
  let best = null;
  for (const tag of git('tag', '--list', 'v*').split('\n').filter(Boolean)) {
    const parsed = parseVersion(tag);
    if (parsed && lower(parsed, current) && (!best || lower(best.parsed, parsed))) best = { tag, parsed };
  }
  return best ? best.tag : null;
}

function changedSince(tag, dir) {
  const result = run('git', ['diff', '--quiet', tag, 'HEAD', '--', dir]);
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff --quiet ${tag} HEAD -- ${dir} failed: ${result.stderr}`);
}

/** The version on the registry, or null when the package was never published. */
function publishedVersion(name) {
  if (registryOverrides.has(name)) return registryOverrides.get(name) || null;
  const result = run('npm', ['view', name, 'version', '--json'], { cwd: resolve(root, '..') });
  if (result.status === 0) {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed.at(-1) : parsed;
  }
  if (/E404|404 Not Found/.test(result.stderr + result.stdout)) return null;
  throw new Error(`npm view ${name} failed: ${result.stderr}`);
}

function buildPlan() {
  const version = readJson(resolve(root, 'package.json')).version;
  const previousTag = previousReleaseTag(version);
  const entries = PACKAGES.map(short => {
    const name = `${SCOPE}/${short}`;
    const dir = `packages/${short}`;
    const published = publishedVersion(name);
    const changed = previousTag ? changedSince(previousTag, dir) : true;
    let reason;
    if (all) reason = 'selected by --all';
    else if (published === null) reason = 'first publish: not on the registry yet';
    else if (!previousTag) reason = 'no earlier release tag';
    else if (changed) reason = `changed since ${previousTag}`;
    else reason = `unchanged since ${previousTag}, ${published} stays`;
    const publish = all || published === null || !previousTag || changed;
    return { short, name, dir, version, published, publish, reason };
  });
  // The sibling range a published manifest carries instead of the workspace "*".
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  for (const entry of entries) {
    const manifest = readJson(resolve(root, entry.dir, 'package.json'));
    entry.siblingRanges = {};
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range !== '*') continue;
      const sibling = byName.get(dep);
      if (!sibling) throw new Error(`${entry.name} depends on ${dep} with "*", which is not a workspace package`);
      const target = sibling.publish ? sibling.version : sibling.published;
      if (!target) throw new Error(`${dep} is skipped this round and has never been published`);
      entry.siblingRanges[dep] = `^${target}`;
    }
  }
  return { version, previousTag, entries };
}

/** Writes the release version and the sibling ranges into the manifests; returns the restore function. */
function prepareManifests(entries) {
  const originals = new Map();
  for (const entry of entries) {
    const file = resolve(root, entry.dir, 'package.json');
    const raw = readFileSync(file, 'utf8');
    originals.set(file, raw);
    const manifest = JSON.parse(raw);
    manifest.version = entry.version;
    for (const [dep, range] of Object.entries(entry.siblingRanges)) manifest.dependencies[dep] = range;
    const newline = raw.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(file, JSON.stringify(manifest, null, 2).replace(/\n/g, newline) + newline);
  }
  return () => {
    for (const [file, raw] of originals) writeFileSync(file, raw);
  };
}

function buildPackages() {
  for (const short of PACKAGES) rmSync(resolve(root, 'packages', short, 'dist'), { recursive: true, force: true });
  const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
  const result = run('node', [tsc, '-b', ...PACKAGES.map(short => `packages/${short}`)], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('tsc -b failed');
}

function npm(npmArgs, label) {
  const result = run('npm', npmArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
  return result.stdout;
}

function describeTarball(entry) {
  const [report] = JSON.parse(npm(['pack', '--dry-run', '--json', '--workspace', entry.dir], `npm pack --dry-run ${entry.name}`));
  const files = report.files.map(file => file.path).sort();
  console.log(`  ${report.filename}: ${report.entryCount} files, ${report.unpackedSize} bytes unpacked`);
  console.log(`    ${files.filter(path => !path.startsWith('dist/')).join(', ')}, dist/ (${files.filter(path => path.startsWith('dist/')).length} files)`);
}

function main() {
  const plan = buildPlan();
  console.log(`release version ${plan.version}; previous release ${plan.previousTag ?? 'none'}`);
  for (const entry of plan.entries) {
    const ranges = Object.entries(entry.siblingRanges).map(([dep, range]) => `${dep} ${range}`).join(', ');
    console.log(`${entry.publish ? 'publish' : 'skip   '} ${entry.name} ${entry.version} (${entry.reason})${ranges ? `; ${ranges}` : ''}`);
  }
  const selected = plan.entries.filter(entry => entry.publish);
  if (!selected.length) {
    console.log('nothing to publish');
    return;
  }
  const restore = prepareManifests(plan.entries);
  try {
    buildPackages();
    if (dryRun) {
      console.log('dry run: tarball contents');
      for (const entry of selected) describeTarball(entry);
      return;
    }
    if (packDir) {
      mkdirSync(packDir, { recursive: true });
      for (const entry of selected) {
        const output = npm(['pack', '--workspace', entry.dir, '--pack-destination', packDir, '--loglevel', 'warn'], `npm pack ${entry.name}`);
        console.log(`packed ${resolve(packDir, output.trim().split('\n').at(-1))}`);
      }
      return;
    }
    for (const entry of selected) {
      npm(['publish', '--workspace', entry.dir, '--access', 'public'], `npm publish ${entry.name}`);
      console.log(`published ${entry.name}@${entry.version}`);
    }
  } finally {
    restore();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
