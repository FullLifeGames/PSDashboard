import { PRNG } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { faintStep } from '../src/dice/logged-block';
import { loadSimMods } from '../src/forward/sim-mods';
import { ALIGNMENT_SEEDS, extractProtocolEvents, isPerfectAlignment, scoreAlignment, type ProtocolEvents } from '../src/hax-alignment';
import { dexOfRules, forcedOn, SWEEP_CASES, sweepBoard, sweepClicks } from './dice-sweep-support';
import type { ForcedDie } from '../src/dice/types';
import { sweepSelection, type Mode } from './dice-fixtures';

await loadSimMods('gen9championsou');

const CAP = 16;

describe.each(SWEEP_CASES)('the faint step finds the seed of the unnamed die: $name', ({ rules, mode }) => {
  const hasMove = dexOfRules(rules).moves.get('metronome').exists;
  test('the rule set has Metronome', () => {
    expect(hasMove, `${rules.name}: Metronome`).toBe(true);
  });
  if (!hasMove) return;

  const clicks = sweepClicks(mode as Mode, 'self');
  const board = (seed: string) => {
    const battle = sweepBoard(rules, 'metronome', mode as Mode, seed);
    battle.prng = new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
    return battle;
  };
  const eventsAt = (seed: string, dice: readonly ForcedDie[] = []): ProtocolEvents => {
    const { battle, start } = forcedOn(board(seed), clicks, [...dice]);
    return extractProtocolEvents(battle.log.slice(start));
  };
  const seed0 = ALIGNMENT_SEEDS[0];
  const natural = eventsAt(seed0);
  const witnesses = ALIGNMENT_SEEDS.slice(1).filter(seed => !isPerfectAlignment(scoreAlignment(eventsAt(seed), natural)));

  test('seed index 0 does not play every log of the seeds (the scene has an unnamed die)', () => {
    expect(witnesses.length, `${rules.name} ${mode}: seeds whose turn differs from seed 0's`).toBeGreaterThan(0);
  });

  test('a turn that fits seed 0 keeps it at the cost of one play', () => {
    const result = faintStep({ battle: board(seed0), expected: natural, seed: seed0, choices: clicks }, []);
    expect(result.seed).toBe(seed0);
    expect(result.plays).toBe(1);
  });

  test('a turn that another seed plays: the step returns that seed and the turn is perfect', () => {
    for (const logSeed of sweepSelection(witnesses, 'seeds')) {
      const expected = eventsAt(logSeed);
      const result = faintStep({ battle: board(seed0), expected, seed: seed0, choices: clicks }, []);
      expect(result.dice, `${rules.name} ${mode} log seed ${logSeed}`).not.toBeNull();
      expect(ALIGNMENT_SEEDS, 'a seed of the pinned list').toContain(result.seed);
      expect(result.seed, 'not the seed that misses the log').not.toBe(seed0);
      expect(isPerfectAlignment(scoreAlignment(expected, eventsAt(result.seed, result.dice!))), `${rules.name} ${mode} log seed ${logSeed}: the turn under ${result.seed}`).toBe(true);
      expect(result.plays, 'one natural play and at most fifteen seeds').toBeLessThanOrEqual(CAP);
    }
  });
});
