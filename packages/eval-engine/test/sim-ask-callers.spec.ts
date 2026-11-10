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
    // The deserializers and the speed layer (forward/), the branch session (`State.deserializeBattle`), and the three
    // `@pkmn/client` batteries of the parser and the header reader (round 72, T241): none of them is a stand-in.
    expect(filesWith(/\bnew Battle\(/)).toEqual([
      'eval-engine:branch/state.ts',
      'eval-engine:forward/sim-fast/guard.ts',
      'replay-core:inference/hits.ts',
      'replay-core:protocol/parser-state.ts',
      'replay-core:replay-format.ts',
    ]);
  });

  test('no source file copies a battle by hand', () => {
    // `forward/` owns the speed layer's copy and the revival of a serialization; `branch/adopt.ts` and
    // `search/bench-order.ts` revive a stored position (not a copy to play on).
    expect(filesWith(/\bcopyBattle\(|deserializeBattleExact\(serializeBattleStable\(|(?:const|function) copyOf\b[^\n]*Battle/, name => name.startsWith('eval-engine:forward/'))).toEqual([]);
  });

  test('the dice of a question come from FixedDice; the other PRNG classes are the search\'s scripts', () => {
    // Round 73 (T232): branch/logged-rolls.ts serves a branch's first turn the draws its log made, a script like the search's.
    // Round 82 (forced dice): dice/prng.ts answers a turn's dice the way logged-rolls.ts does, a script that stands over the
    // battle's own stream and asks the simulator nothing (it is a script; the learners replay a turn on a copy through it).
    // The one question the module puts to a Dex handler, status-probe.ts, plays on a copy with FixedDice.
    expect(filesWith(/\bextends (?:PRNG|BattlePRNG)\b/)).toEqual([
      'eval-engine:branch/logged-rolls.ts',
      'eval-engine:dice/prng.ts',
      'eval-engine:forward/scripted-prng.ts',
      'eval-engine:pair/prng.ts',
    ]);
  });

  test('a Dex handler called on a stand-in `this` lives only in the named rests', () => {
    const called = filesWith(/\.call\(/, name => name.includes('sim-fast/'));
    // Rests of T239 outside the files of its lane (the plan's finding 8 and the inference of replay-core): read-only by use.
    const rests = [
      'eval-engine:branch/sleep-counter.ts', 'eval-engine:calc/body.ts', 'eval-engine:calc/fickle.ts',
      'eval-engine:calc/typeless.ts', 'eval-engine:damage-calc.ts', 'eval-engine:score/move-facts.ts',
      'replay-core:inference/item-evidence.ts', 'replay-core:inference/item-triggers.ts', 'replay-core:inference/rocks-tell.ts',
      'replay-core:inference/trigger-evidence.ts',
      // Round 88 (T349): the terrain seeds' and Room Service's own handlers on a recording stand-in holder with no battle
      // behind it, held to the simulator by replay-core's field-item-triggers-sweep.spec.ts (every scene of the five items,
      // Generations 6 to 9 and Champions, singles and doubles).
      'replay-core:inference/field-item-triggers.ts',
      // Round 73 (T210): a recording stand-in with no battle behind it, so nothing can be written; held to the simulator by
      // replay-core's hit-power-census.spec.ts (every Dex, Generations 1 to 9 and Champions) and hit-power-played.spec.ts.
      'replay-core:spreads/hit-power.ts',
      // Round 86 (T310): a stand-in source with no battle behind it, held to the simulator by replay-core's
      // screen-turns-sweep.spec.ts (every screen condition and every item, Generations 1 to 9 and Champions).
      'replay-core:dex-facts/screen-turns.ts',
    ];
    expect(called).toEqual([...rests].sort());
  });

  test('the rebuild asks the queue for the priority of a stand-in and of a logged action', () => {
    // Round 89 (#111): the stand-in of a body the log never shows acting (`protocol-choices.ts`) and the order of a cant line
    // (`cant-stand-in.ts`) read the simulator's priority of the action (`actionPriority`, `queuePlace`: Prankster, Gale Wings, Triage,
    // Stall, Quick Claw and the other handlers), not the Dex move's. The one Dex read left is the move of a logged body that is off the
    // field, whose handlers the battle cannot show. The sweep `stand-in-priority-sweep.spec.ts` holds both to the simulator.
    // Round 89 (#108): `action-bound.ts` holds the order rules both read (the places of the logged actions, `loggedActions`) and the bound of a
    // body that fell before it acted (`ruledOutMoves`); the Dex read of an off-field body moved there from `cant-stand-in.ts`.
    const rebuild = ['eval-engine:branch/action-bound.ts', 'eval-engine:branch/cant-stand-in.ts', 'eval-engine:branch/protocol-choices.ts'];
    expect(filesWith(/\b(?:actionPriority|queuePlace)\(/)).toEqual(rebuild);
    expect(filesWith(/\.moves\.get\([^)]*\)\.priority\b/).filter(name => rebuild.includes(name))).toEqual(['eval-engine:branch/action-bound.ts']);
  });
});
