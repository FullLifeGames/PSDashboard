import { PRNG } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { faintStep } from '../src/dice/logged-block';
import { loadSimMods } from '../src/forward/sim-mods';
import { ALIGNMENT_SEEDS, extractProtocolEvents, isPerfectAlignment, scoreAlignment, type ProtocolEvents } from '../src/hax-alignment';
import { dexOfRules, forcedOn, SWEEP_CASES, sweepBoard, sweepClicks } from './dice-sweep-support';
import type { ForcedDie } from '../src/dice/types';
import type { Mode } from './dice-fixtures';

/**
 * Round 86 (the engine reads the dice), lane B, step B9 (T306, the hybrid of ruling C2): the seed search after the faint step. The dice
 * the module names are forced from the log, and the rest of the turn plays under the hidden dice of one seed. A die no `DieKind` names
 * (a sleep duration, the move that Metronome calls, the lock of Outrage) falls to that seed, and under seed index 0 it can miss the
 * log. The faint step then tries seeds 1 to 15 of `ALIGNMENT_SEEDS` for the unforced dice and returns the seed with the turn: perfect
 * where one seed fits, otherwise the best by (ended, faint, soft).
 *
 * The scene: Snorlax uses Metronome, whose called move is a sample no die names, in every rule set the corpus plays (Gens 1 to 9 and
 * the Champions mod, singles and doubles). The log's turn is the turn that seed index k plays; the forced list is empty because the
 * scene draws no named die the log could force. Where seed 0 plays another turn, the step must return a seed under which the turn is
 * the log's turn.
 */

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
    for (const logSeed of witnesses.slice(0, 4)) {
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
