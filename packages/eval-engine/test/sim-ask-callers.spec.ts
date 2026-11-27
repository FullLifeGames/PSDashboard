import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';


const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = ['eval-engine', 'replay-core'].flatMap(name => sources(join(PACKAGES, name, 'src'))).map(path => ({
  name: relative(PACKAGES, path).replaceAll('\\', '/').replace('/src/', ':'),
  text: stripComments(readFileSync(path, 'utf8')),
}));

const filesWith = (pattern: RegExp, skip: (name: string) => boolean = () => false): string[] =>
  FILES.filter(file => !file.name.includes('/sim-ask/') && !file.name.includes(':sim-ask/') && !skip(file.name) && pattern.test(file.text))
    .map(file => file.name).sort();

describe('the callers of the simulator', () => {
  test('no source file builds a battle by hand but the ones that revive or follow a replay', () => {
    expect(filesWith(/\bnew Battle\(/)).toEqual([
      'eval-engine:branch/state.ts',
      'eval-engine:forward/sim-fast/guard.ts',
      'replay-core:inference/hits.ts',
      'replay-core:protocol/parser-state.ts',
      'replay-core:replay-format.ts',
    ]);
  });

  test('no source file copies a battle by hand', () => {
    expect(filesWith(/\bcopyBattle\(|deserializeBattleExact\(serializeBattleStable\(|(?:const|function) copyOf\b[^\n]*Battle/, name => name.startsWith('eval-engine:forward/'))).toEqual([]);
  });

  test('the dice of a question come from FixedDice; the other PRNG classes are the search\'s scripts', () => {
    expect(filesWith(/\bextends (?:PRNG|BattlePRNG)\b/)).toEqual([
      'eval-engine:branch/logged-rolls.ts',
      'eval-engine:dice/prng.ts',
      'eval-engine:forward/scripted-prng.ts',
      'eval-engine:pair/prng.ts',
    ]);
  });

  test('a Dex handler called on a stand-in `this` lives only in the named rests', () => {
    const called = filesWith(/\.call\(/, name => name.includes('sim-fast/'));
    const rests = [
      'eval-engine:branch/sleep-counter.ts', 'eval-engine:calc/body.ts', 'eval-engine:calc/fickle.ts',
      'eval-engine:calc/typeless.ts', 'eval-engine:damage-calc.ts', 'eval-engine:score/move-facts.ts',
      'replay-core:inference/item-evidence.ts', 'replay-core:inference/item-triggers.ts', 'replay-core:inference/rocks-tell.ts',
      'replay-core:inference/trigger-evidence.ts', 'replay-core:inference/spent-items.ts', 'replay-core:inference/stat-items.ts', 'replay-core:inference/contact-tell.ts',
      // Held to the simulator by replay-core's field-item-triggers-sweep.spec.ts.
      'replay-core:inference/field-item-triggers.ts',
      // Held to the simulator by replay-core's hit-power-census.spec.ts and hit-power-played.spec.ts.
      'replay-core:spreads/hit-power.ts',
      // Held to the simulator by replay-core's screen-turns-sweep.spec.ts.
      'replay-core:dex-facts/screen-turns.ts',
    ];
    expect(called).toEqual([...rests].sort());
  });

  test('the rebuild asks the queue for the priority of a stand-in and of a logged action', () => {
    // Both are held to the simulator by stand-in-priority-sweep.spec.ts.
    const rebuild = ['eval-engine:branch/action-bound.ts', 'eval-engine:branch/cant-stand-in.ts', 'eval-engine:branch/protocol-choices.ts'];
    // forced-win-strike-sweep.spec.ts holds the prover's queue question to the simulator.
    expect(filesWith(/\b(?:actionPriority|queuePlace)\(/)).toEqual([...rebuild, 'eval-engine:endgame/prover-strike.ts']);
    expect(filesWith(/\.moves\.get\([^)]*\)\.priority\b/).filter(name => rebuild.includes(name))).toEqual(['eval-engine:branch/action-bound.ts']);
  });
});
