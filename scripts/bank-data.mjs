// The bank's data as one gzipped tar; fixed modes, owners, times and gzip level make equal folders give equal bytes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CACHE_DIRS, dataFileNames, hashFiles } from './calibration-fingerprint.mjs';

const BLOCK = 512;
const GZIP_LEVEL = 9;
const sha256 = data => createHash('sha256').update(data).digest('hex');

function writeText(header, offset, length, text) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > length) throw new Error(`tar field too long for "${text}"`);
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  writeText(header, offset, length, value.toString(8).padStart(length - 1, '0'));
}

/** One ustar entry of 512-byte header and padded content; `type` is the ustar type flag ('0' a regular file). */
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

export function tarEnd() {
  return Buffer.alloc(2 * BLOCK);
}

/** Packs the data folders under `root`; `selection` names the files per folder, null for all of them. */
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

function refusal(name, dirs) {
  if (name.includes('\\')) return 'a backslash';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'an absolute path';
  const parts = name.split('/');
  if (parts.some(part => part === '..' || part === '.' || part === '')) return 'a parent step or an empty part';
  if (parts.length < 2 || !dirs.includes(parts[0])) return `a path outside ${dirs.join(' and ')}`;
  return null;
}

/** Unpacks a packData archive into `root`; a refused entry throws before the first file is written. */
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
    // packData never writes the ustar prefix field (every name fits 100 bytes), so an entry with one is foreign.
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

/** The bytes at `url`, retried on network, server and rate-limit errors; a client error such as 404 fails at once. */
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
