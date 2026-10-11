import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickerStateFromSerialized } from '../../src/lib/picker-state';

/**
 * Round 67 (T145, merge): the stored picker revives a recorded Champions
 * position on the Champions mod. The picker module is only ever lazy-loaded and
 * nothing before it loads the mod, so it loads the mod from the position itself
 * before it deserializes one. The positions are lane F's two turn-3 fixtures.
 */
const position = (id: string) => (JSON.parse(readFileSync(
  join('packages', 'eval-engine', 'test', 'fixtures', 'champions', `${id}.position.json`), 'utf-8',
)) as { serialized: string }).serialized;

describe('stored picker on a Champions position (T145)', () => {
  const positions = [['singles', 'gen9championsou-2693832490-t3'], ['doubles', 'gen9championsvgc2026regmbbo3-2679053861-t3']] as const;
  for (const [kind, id] of positions) {
    test(`pickerStateFromSerialized revives a Champions ${kind} position`, async () => {
      await expect(pickerStateFromSerialized(position(id))).resolves.toBeDefined();
    });
  }
});
