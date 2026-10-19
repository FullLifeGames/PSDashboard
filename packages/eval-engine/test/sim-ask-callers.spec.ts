import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Round 72 (T239): the census of the callers. One module (`src/sim-ask/`) asks the simulator: the twin battle, copy and
 * play with fixed dice, a handler called with a throwaway `this`. This reads every source file of both packages and
 * lists who still does it by hand. A new hand-made battle, copy, dice class or handler stand-in fails here; a rest is
 * named below with the reason it stays.
 */

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The code without comments, so a sentence that names `new Battle(` is not a call. */
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Source files of both packages by path below `packages/`, with the text. */
const FILES = ['eval-engine', 'replay-core'].flatMap(name => sources(join(PACKAGES, name, 'src'))).map(path => ({
  name: relative(PACKAGES, path).replaceAll('\\', '/').replace('/src/', ':'),
  text: stripComments(readFileSync(path, 'utf8')),
}));

const filesWith = (pattern: RegExp, skip: (name: string) => boolean = () => false): string[] =>
  FILES.filter(file => !file.name.includes('/sim-ask/') && !file.name.includes(':sim-ask/') && !skip(file.name) && pattern.test(file.text))
    .map(file => file.name).sort();

describe('the callers of the simulator', () => {
  test('no source file builds a battle by hand but the ones that revive or follow a replay', () => {
    // The deserializers and the speed layer (forward/), the branch session (`State.deserializeBattle`), and the two
    // `@pkmn/client` batteries of the parser: none of them is a stand-in.
    expect(filesWith(/\bnew Battle\(/)).toEqual([
      'eval-engine:branch/state.ts',
      'eval-engine:forward/sim-fast/guard.ts',
      'replay-core:inference/hits.ts',
      'replay-core:protocol/parser-state.ts',
    ]);
  });

  test('no source file copies a battle by hand', () => {
    // `forward/` owns the speed layer's copy and the revival of a serialization; `branch/adopt.ts` and
    // `search/bench-order.ts` revive a stored position (not a copy to play on).
    expect(filesWith(/\bcopyBattle\(|deserializeBattleExact\(serializeBattleStable\(|(?:const|function) copyOf\b[^\n]*Battle/, name => name.startsWith('eval-engine:forward/'))).toEqual([]);
  });

  test('the dice of a question come from FixedDice; the other PRNG classes are the search\'s scripts', () => {
    expect(filesWith(/\bextends (?:PRNG|BattlePRNG)\b/)).toEqual([
      'eval-engine:forward/scripted-prng.ts',
      'eval-engine:pair/prng.ts',
    ]);
  });

  test('a Dex handler called on a stand-in `this` lives only in the named rests', () => {
    const called = filesWith(/\.call\(/, name => name.includes('sim-fast/'));
    // Lane A's two, the stand-ins of the protect check; they move onto `callHandler` after the merge (step 6).
    const waiting = ['eval-engine:calc/protect.ts', 'eval-engine:search/hints.ts'];
    // Rests of T239 outside the files of its lane (the plan's finding 8 and the inference of replay-core): read-only by use.
    const rests = [
      'eval-engine:branch/sleep-counter.ts', 'eval-engine:calc/body.ts', 'eval-engine:calc/fickle.ts', 'eval-engine:calc/move.ts',
      'eval-engine:calc/typeless.ts', 'eval-engine:damage-calc.ts', 'eval-engine:score/move-facts.ts',
      'replay-core:inference/item-evidence.ts', 'replay-core:inference/item-triggers.ts', 'replay-core:inference/rocks-tell.ts',
      'replay-core:inference/trigger-evidence.ts',
    ];
    expect(called).toEqual([...waiting, ...rests].sort());
  });
});
