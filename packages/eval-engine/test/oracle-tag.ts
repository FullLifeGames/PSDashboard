import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * The tag that ties a hand list to its spec: the comment block directly above `declaration` in `file` (a path from the
 * repository root) contains `oracle: <spec>`. A list loses its tag, or a spec moves, and the spec fails here.
 */
export function oracleTagAbove(file: string, declaration: string, spec: string): boolean {
  const lines = readFileSync(resolve(REPO_ROOT, file), 'utf8').split(/\r?\n/);
  const at = lines.findIndex(line => line.includes(declaration));
  if (at < 0) throw new Error(`${file} has no line with ${declaration}`);
  const block: string[] = [];
  for (let index = at - 1; index >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[index]); index--) block.push(lines[index]);
  return block.some(line => line.includes(`oracle: ${spec}`));
}
