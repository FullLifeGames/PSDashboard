import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport, ForcedDie } from '../src/dice/types';
import { copyOf } from '../src/sim-ask/copy';
import { EFFECT_SPORE, hitDie, present, procBoard } from './dice-ability-support';
import { playClicks } from './dice-fixtures';
import { forcedOn, SWEEP_CASES, sweepClicks } from './dice-sweep-support';

// Round 82 (forced dice), lane A4, plan D6: Effect Spore. Gens 3 and 4 draw a chance and then pick the status with a `sample`
// over the three words (two dice: the proc and its `:option`). Gens 5 and on draw one number from 0 to 99 and the script
// compares it with thresholds: below the first it puts the target to sleep, below the second it paralyses, below the third it
// poisons, and above them nothing happens. The module never keeps the thresholds: it plays the turn on copies with raw
// answers and reads the status from the protocol (learn.ts). This sweep plays all 100 raw numbers on a spy, holds that each
// status is one run of numbers, and then forces every result in every rule set, singles and doubles.
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const WORDS = ['slp', 'par', 'psn'];
const why = (report: DieReport): string => `${report.took}: ${report.reason ?? 'no reason'}`;
const dieOf = (effectId: string, result: ForcedDie['result']): ForcedDie => ({ name: { slot: 'p1a', moveId: 'tackle', targetSlot: 'p2a', kind: 'ability-proc', effectId }, result });

/**
 * The status the protocol shows on the attacker (the spore lands on the body that hit), or null. The sleep of Gens 3 and 4 is
 * written without the ability's label, so the line is read by the body.
 */
function statusShown(battle: Battle, start: number): string | null {
  const line = battle.log.slice(start).find(candidate => candidate.startsWith('|-status|p1a'));
  return line ? line.split('|')[3] : null;
}

/** The status the simulator gives when Effect Spore's `random(100)` comes out as `raw`: the oracle of the learner. */
function statusAtRaw(board: Battle, clicks: { p1: string; p2: string }, raw: number): string | null {
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  const natural = battle.prng;
  battle.prng = new (class extends PRNG {
    override random(from?: number, to?: number): number {
      const value = natural.random(from, to);
      const inSpore = (battle.effect as { id?: string } | undefined)?.id === EFFECT_SPORE.id && (battle.event as { id?: string } | undefined)?.id === 'DamagingHit';
      return inSpore && from === 100 && to === undefined ? raw : value;
    }
  })(natural.getSeed());
  const start = battle.log.length;
  playClicks(battle, clicks);
  return statusShown(battle, start);
}

describe.each(SWEEP_CASES.filter(({ rules }) => present(rules, 'abilities', 'effectspore')))('Effect Spore: $name', ({ rules, mode, name }) => {
  const clicks = sweepClicks(mode, 'normal');
  const board = () => procBoard(rules, mode, EFFECT_SPORE);
  const single = rules.generation >= 5;
  let cases = 0;

  if (single) {
    test('the 100 raw numbers give each status as one run of numbers', () => {
      const statuses = Array.from({ length: 100 }, (_, raw) => statusAtRaw(board(), clicks, raw));
      const runs = statuses.filter((status, raw) => status !== statuses[raw - 1]);
      expect(new Set(runs).size, `every status is one run: ${runs.join(',')}`).toBe(runs.length);
      expect(runs.filter(run => run !== null).sort()).toEqual([...WORDS].sort());
      expect(statuses[99], 'a high number gives nothing').toBeNull();
    });

    test.each(WORDS)('forced %s: the status the protocol shows', word => {
      const { report, battle, start } = forcedOn(board(), clicks, [hitDie('tackle'), dieOf('effectspore', { option: word })]);
      cases++;
      expect(report.forced[1].took, why(report.forced[1])).toBe('applied');
      expect(statusShown(battle, start)).toBe(word);
    });

    test.each([true, false])('forced happens %s', happens => {
      const { report, battle, start } = forcedOn(board(), clicks, [hitDie('tackle'), dieOf('effectspore', { happens })]);
      cases++;
      expect(report.forced[1].took, why(report.forced[1])).toBe('applied');
      expect(statusShown(battle, start) !== null).toBe(happens);
    });
  } else {
    test.each(WORDS)('forced yes with %s', word => {
      const { report, battle, start } = forcedOn(board(), clicks, [hitDie('tackle'), dieOf('effectspore', { happens: true }), dieOf('effectspore:option', { option: word })]);
      cases += 2;
      expect(report.forced.slice(1).map(shown => shown.took), report.forced.map(why).join(' / ')).toEqual(['applied', 'applied']);
      expect(statusShown(battle, start)).toBe(word);
    });

    test('forced no: the pick is never drawn', () => {
      const { report, battle, start } = forcedOn(board(), clicks, [hitDie('tackle'), dieOf('effectspore', { happens: false }), dieOf('effectspore:option', { option: 'par' })]);
      cases += 2;
      expect(report.forced[1].took, why(report.forced[1])).toBe('applied');
      expect(report.forced[2].took, why(report.forced[2])).toBe('no-draw');
      expect(statusShown(battle, start)).toBeNull();
    });
  }

  test('a status the target cannot take is blocked, not reported as given', () => {
    // the spore lands on the attacker: a burnt attacker keeps its status and the effect's line does not follow
    const burnt = board();
    burnt.sides[0].active[0]!.setStatus('brn');
    const { report } = forcedOn(burnt, clicks, single
      ? [hitDie('tackle'), dieOf('effectspore', { option: 'par' })]
      : [hitDie('tackle'), dieOf('effectspore', { happens: true }), dieOf('effectspore:option', { option: 'par' })]);
    // Gens 5 and on: no number gives a status the attacker cannot take (the learner finds none); Gens 3 and 4: the pick draws and the line does not follow
    const last = report.forced[report.forced.length - 1];
    expect(last.took, why(last)).toBe(single ? 'no-chance' : 'blocked');
  });

  test('the sweep was exercised', () => {
    summaries.push(`${name}: ${cases} forced dice${single ? ', 100 raw numbers' : ''}`);
    expect(cases).toBeGreaterThan(2);
  });
});
