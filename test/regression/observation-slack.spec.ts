import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * #133: the slack of an HP-bar reading (the bar's noise is about two points) is one rule. replay-core defines it once in
 * `team/item-damage-shared.ts`; the spread fit imports it. The Choice-lock check in eval-engine keeps a deliberate copy (a package
 * reaches the other only through its barrel, and the barrel does not export the constant), and this spec holds the copy equal.
 * The sources are read as text: the spec imports no package internals, so it stays inside the lint zone of the root specs.
 */

const source = (path: string): string => readFileSync(new URL(`../../packages/${path}`, import.meta.url), 'utf-8');

const SHARED = 'replay-core/src/team/item-damage-shared.ts';
const FIT = 'replay-core/src/spreads/fit.ts';
const CHOICE_LOCK = 'eval-engine/src/choice-lock.ts';

const DEFINITION = /^(?:export )?const OBSERVATION_SLACK = ([0-9.]+);$/m;

describe('OBSERVATION_SLACK (#133)', () => {
  test('replay-core defines it once, in item-damage-shared.ts, and exports it', () => {
    const text = source(SHARED);
    expect(text).toMatch(/^export const OBSERVATION_SLACK = [0-9.]+;$/m);
    expect(text.match(/OBSERVATION_SLACK = /g)).toHaveLength(1);
  });

  test('the spread fit holds no definition of its own and imports the shared one', () => {
    const text = source(FIT);
    expect(text).not.toMatch(/\bconst OBSERVATION_SLACK\b/);
    expect(text).toMatch(/^import \{[^}]*\bOBSERVATION_SLACK\b[^}]*\} from '\.\.\/team\/item-damage-shared\.ts';$/m);
  });

  test('the Choice-lock check keeps a copy of the same value', () => {
    const shared = DEFINITION.exec(source(SHARED));
    const copy = DEFINITION.exec(source(CHOICE_LOCK));
    expect(shared).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(Number(copy![1])).toBe(Number(shared![1]));
  });
});
