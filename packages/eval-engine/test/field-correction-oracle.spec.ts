import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fieldMismatches } from './field-oracle';

describe('snapshot numbers fit the simulator (round 60, T92 prover)', () => {
  for (const name of ['replay', 'gpl-replay', 'draft-replay', 'smogtours-gen6ou-649664']) {
    test(name, async () => {
      const replay = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8'));
      const { checked, found } = await fieldMismatches(replay);
      expect(checked).toBeGreaterThan(0);
      expect(found).toEqual([]);
    }, 300_000);
  }
});
