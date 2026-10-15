import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { MANIFESTS, PKMN_EXACT, planPkmnUpgrade } from '../scripts/upgrade-pkmn.mjs';

/**
 * Round 70 (T43): eval-engine's speed layer copies classes of one @pkmn/sim version and checks no hash in the
 * browser, so every manifest pins @pkmn/sim and @pkmn/mods to one exact version and a library user cannot pull
 * another simulator under it. `npm run upgrade:pkmn [version]` moves the whole release train at once.
 */

type Manifest = Record<string, Record<string, string> | undefined>;
const read = (path: string): Manifest => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as Manifest;
const specsOf = (manifest: Manifest, name: string): string[] =>
  ['dependencies', 'devDependencies', 'peerDependencies'].map(section => manifest[section]?.[name]).filter((spec): spec is string => !!spec);

describe('the simulator pin', () => {
  test('every manifest pins @pkmn/sim and @pkmn/mods to one exact version', () => {
    const versions = new Set<string>();
    for (const path of MANIFESTS) {
      for (const name of PKMN_EXACT) {
        for (const spec of specsOf(read(path), name)) {
          expect(spec, `${path} ${name}`).toMatch(/^\d+\.\d+\.\d+$/);
          versions.add(spec);
        }
      }
    }
    expect(versions.size).toBe(1);
  });

  test('the upgrade moves the train: sim and mods exact, dex and data from the same release, nothing else', () => {
    const manifest = {
      dependencies: { '@pkmn/sim': '0.10.11', '@pkmn/dex': '^0.10.11', '@pkmn/client': '^0.7.3' },
      peerDependencies: { '@pkmn/mods': '^0.10.11', '@pkmn/data': '^0.10.11' },
    };
    expect(planPkmnUpgrade(manifest, '0.10.12')).toEqual({
      dependencies: { '@pkmn/sim': '0.10.12', '@pkmn/dex': '^0.10.12', '@pkmn/client': '^0.7.3' },
      peerDependencies: { '@pkmn/mods': '0.10.12', '@pkmn/data': '^0.10.12' },
    });
    expect(manifest.dependencies['@pkmn/sim']).toBe('0.10.11');
  });

  test('a version that is no plain release is refused', () => {
    expect(() => planPkmnUpgrade({}, '^0.10.12')).toThrow(/plain release/);
    expect(() => planPkmnUpgrade({}, 'latest')).toThrow(/plain release/);
  });
});
