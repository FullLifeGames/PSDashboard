// The bank's data as one gzipped tar (round 71, bank in GitHub Actions).
//
// A CI job has no .fit-corpus and no .smogon-cache; the bank reads both. packData writes their files (the names the
// fingerprint hashes, calibration-fingerprint.mjs dataFileNames) into a POSIX ustar archive in code unit order, with
// fixed modes, owners and times, so two packs of the same folders give the same tar; gzip runs at a fixed level.
// The archive's identity is the sha256 of the tar (the same on every platform); a download is checked against the
// sha256 of the gzipped file it fetched. unpackData reads the archive back and refuses, before it writes anything,
// every entry that is not a regular file under the two folders: a link, a folder entry, a parent step, an absolute
// or drive path, a backslash, a damaged header.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CACHE_DIRS, dataFileNames, hashFiles } from './calibration-fingerprint.mjs';

const BLOCK = 512;
const GZIP_LEVEL = 9;
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** One field of a ustar header: ASCII text, NUL padded. */
function writeText(header, offset, length, text) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > length) throw new Error(`tar field too long for "${text}"`);
  bytes.copy(header, offset);
}

/** One octal number field of a ustar header, zero padded, NUL terminated. */
function writeOctal(header, offset, length, value) {
  writeText(header, offset, length, value.toString(8).padStart(length - 1, '0'));
}

/**
 * One ustar entry: the 512-byte header and the content padded to whole blocks. `type` is the ustar type flag ('0'
 * a regular file; the specs build '2' links and '5' folders to show that unpackData refuses them).
 */
export function tarEntry(name, data, { type = '0', linkName = '' } = {}) {
  const header = Buffer.alloc(BLOCK);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === '0' ? data.length : 0);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeText(header, 156, 1, type);
  writeText(header, 157, 100, linkName);
  writeText(header, 257, 6, 'ustar');
  writeText(header, 263, 2, '00');
  let sum = 0;
  for (const byte of header) sum += byte;
  writeText(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  const body = type === '0' ? data : Buffer.alloc(0);
  const padding = Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK);
  return Buffer.concat([header, body, padding]);
}

/** The end of a tar: two empty blocks. */
export function tarEnd() {
  return Buffer.alloc(2 * BLOCK);
}

/**
 * Packs the data folders under `root`. `selection` names, per folder, the relative file names to pack, or null for
 * every file the folder holds (dataFileNames). Returns the gzipped archive, its sha256 (what a download is checked
 * against), the sha256 of the plain tar (the archive's identity), the file count and, per folder, the hash of the
 * packed files in the fingerprint's recipe: what the folder hashes to once a checkout holds exactly these files.
 */
export function packData(root, selection = Object.fromEntries(CACHE_DIRS.map(dir => [dir, null]))) {
  const parts = [];
  const dirs = {};
  let files = 0;
  for (const [dir, chosen] of Object.entries(selection)) {
    const names = [...(chosen ?? dataFileNames(join(root, dir)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      parts.push(tarEntry(`${dir}/${name}`, readFileSync(join(root, dir, ...name.split('/')))));
      files += 1;
    }
    dirs[dir] = hashFiles(join(root, dir), names);
  }
  parts.push(tarEnd());
  const tar = Buffer.concat(parts);
  const gz = gzipSync(tar, { level: GZIP_LEVEL });
  return { gz, sha256: sha256(gz), tarSha256: sha256(tar), files, dirs };
}

const readText = (block, offset, length) => {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? length : end).toString('utf8');
};
const readOctal = (block, offset, length) => parseInt(readText(block, offset, length).trim() || '0', 8);

/** The entry's path, or the reason it is refused: only a plain relative path inside one of the data folders. */
function refusal(name, dirs) {
  if (name.includes('\\')) return 'a backslash';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'an absolute path';
  const parts = name.split('/');
  if (parts.some(part => part === '..' || part === '.' || part === '')) return 'a parent step or an empty part';
  if (parts.length < 2 || !dirs.includes(parts[0])) return `a path outside ${dirs.join(' and ')}`;
  return null;
}

/**
 * Unpacks a gzipped archive of packData into `root`. Every entry is checked before the first file is written; a
 * refused entry throws and leaves `root` untouched. Returns the number of files written.
 */
export function unpackData(gz, root, dirs = CACHE_DIRS) {
  const tar = gunzipSync(gz);
  const entries = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every(byte => byte === 0)) break;
    const stored = readOctal(block, 148, 8);
    let sum = 0;
    for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : block[index];
    if (stored !== sum) throw new Error(`unpackData refuses the archive: a header checksum does not match at byte ${offset}`);
    const name = readText(block, 0, 100);
    const type = readText(block, 156, 1) || '0';
    const size = readOctal(block, 124, 12);
    if (type !== '0') throw new Error(`unpackData refuses "${name}": not a regular file (type ${type})`);
    // packData never writes the ustar prefix field (every name fits the 100-byte field), so an entry with one is foreign.
    if (readText(block, 345, 155) !== '') throw new Error(`unpackData refuses "${name}": a name prefix packData never writes`);
    const reason = refusal(name, dirs);
    if (reason) throw new Error(`unpackData refuses "${name}": ${reason}`);
    const start = offset + BLOCK;
    if (start + size > tar.length) throw new Error(`unpackData refuses "${name}": the archive ends inside it`);
    entries.push({ name, data: tar.subarray(start, start + size) });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  for (const { name, data } of entries) {
    const path = join(root, ...name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  return { files: entries.length };
}

/**
 * The bytes at `url`, fetched again after a network error, a server error or a rate limit; a client error such as a 404
 * fails at once (round 72: a CI job met HTTP 504 on the data release, and the run's merge lost its slices).
 */
export async function downloadWithRetry(url, { fetcher = fetch, attempts = 4, pauses = [5000, 15000, 30000] } = {}) {
  let last = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise(done => setTimeout(done, pauses[Math.min(attempt - 1, pauses.length - 1)]));
    let response;
    try {
      response = await fetcher(url, { redirect: 'follow' });
    } catch (error) {
      last = `network error (${error?.cause?.code ?? error?.message ?? error})`;
      continue;
    }
    if (response.ok) {
      try {
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        last = `the body broke off (${error?.message ?? error})`;
        continue;
      }
    }
    last = `HTTP ${response.status}`;
    if (response.status < 500 && response.status !== 429) break;
  }
  throw new Error(`download of ${url} failed: ${last}`);
}
