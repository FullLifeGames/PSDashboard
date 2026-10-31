import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport, ForcedDie } from '../src/dice/types';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { attacker, CHECK_MOVES, CHECKS, started, type Check } from './dice-status-support';
import { dexOfRules, forcedOn, monOf, newTally, SWEEP_CASES, sweepBoard, sweepClicks, type Tally } from './dice-sweep-support';

// Round 82 (forced dice), lane A3b: the status checks of the attacker. The simulator draws them inside the attacker's own
// action, in `BeforeMove`, before the move runs: full paralysis, the thaw, the infatuation and the confusion check (its
// self-hit rolls its own damage). Every check, in every rule set the corpus plays (Gens 1 to 9, the Champions mod), singles and
// doubles, with each of a few moves (a physical one, a spread one, a status move, a move that thaws its user), forced to
// happen and not to. The witness is the protocol: `|cant|` for a stop, `|-curestatus|` for a thaw, `|-damage|` with
// `[from] confusion` for the self-hit, the body's own `|move|` when it goes on.
//
// "Happens" is what the body does: yes lets it go on (the paralysed body moves, the frozen body thaws, the infatuated body
// moves, the confused body does not hit itself), no stops it. The simulator writes the draw's polarity its own way (the
// confusion check lets the body go on when the chance comes true up to Gen 6 and hits it from Gen 7), so the module reads the
// polarity from the condition's handler (status-probe.ts) and this sweep reads it from a plain turn whose draw a spy answers
// "true". The reported chance is the chance of the answer. The Gen 2 thaw falls at the end of the turn (A4), Gen 1 has none.
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const shows = (battle: Battle, start: number, pattern: RegExp): boolean => battle.log.slice(start).some(line => pattern.test(line));

const dieOf = (moveId: string, effectId: string, happens: boolean): ForcedDie => ({ name: { slot: 'p1a', moveId, kind: 'status-check', effectId }, result: { happens } });
const why = (report: DieReport): string => `${report.took}: ${report.reason ?? 'no reason'}`;

/**
 * The oracle for the chance of the answer "the body goes on": the chance the simulator itself passes to `randomChance` while
 * the check's own handler runs (event `BeforeMove`, effect the condition), read from a plain turn under a spy over the battle's
 * stream; and which way the draw goes, read from a second turn whose draw the spy answers "true" (the body's own `|move|`
 * follows or not). Null when the simulator draws no such chance.
 */
function chanceOf(board: Battle, clicks: { p1: string; p2: string }, effectId: string): number | null {
  const first = spy(board, clicks, effectId, undefined);
  if (first.seen === null) return null;
  return spy(board, clicks, effectId, true).moved ? first.seen : 1 - first.seen;
}

function spy(board: Battle, clicks: { p1: string; p2: string }, effectId: string, answer: boolean | undefined): { seen: number | null; moved: boolean } {
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  const natural = battle.prng;
  let seen: number | null = null;
  battle.prng = new (class extends PRNG {
    override random(from?: number, to?: number): number {
      return natural.random(from, to);
    }
    override randomChance(numerator: number, denominator: number): boolean {
      const drawn = natural.randomChance(numerator, denominator);
      const event = battle.event as { id?: string } | undefined;
      const effect = battle.effect as { id?: string } | undefined;
      if (event?.id !== 'BeforeMove' || effect?.id !== effectId) return drawn;
      seen ??= numerator / denominator;
      return answer ?? drawn;
    }
  })(natural.getSeed());
  const start = battle.log.length;
  playClicks(battle, clicks);
  return { seen, moved: battle.log.slice(start).some(line => line.startsWith('|move|p1a: ')) };
}

const SEEDS = ['1,2,3,4', '5,6,7,8'];

/** A case: one check, one move, one board; both answers on both seeds. Returns the problems found. */
function exercise(rules: Rules, mode: Mode, check: Check, moveId: string, tally: Tally): string[] {
  const dex = dexOfRules(rules);
  const move = dex.moves.get(moveId);
  if (!move.exists || move.gen > dex.gen) return [];
  const problems: string[] = [];
  const clicks = sweepClicks(mode, move.target);
  for (const seed of SEEDS) {
    const board = sweepBoard(rules, moveId, mode, seed);
    check.start(board);
    const defrosts = check.id === 'frz' && !!move.flags.defrost;
    const oracle = chanceOf(board, clicks, check.id);
    for (const happens of [true, false]) {
      const { report, battle, start } = forcedOn(board, clicks, [dieOf(moveId, check.id, happens)]);
      tally.cases++;
      problems.push(...judge({ label: `${seed} ${happens ? 'yes' : 'no'}`, shown: report.forced[0], happens, defrosts, oracle, check, battle, start }, tally));
    }
  }
  return problems;
}

interface Case { label: string; shown: DieReport; happens: boolean; defrosts: boolean; oracle: number | null; check: Check; battle: Battle; start: number }

/** The problems of one forced answer: the report against the oracle's chance and the protocol's lines. */
function judge({ label, shown, happens, defrosts, oracle, check, battle, start }: Case, tally: Tally): string[] {
  if (oracle === null) {
    // Gens 5 and up: a move that thaws its user draws no thaw, the die is never drawn
    if (!defrosts) return [`${label}: the oracle saw no draw`];
    if (shown.took !== 'no-draw' || !/thaw/.test(shown.reason ?? '')) return [`${label}: ${why(shown)}`];
    tally.noDraw++;
    return [];
  }
  if (defrosts && !happens) {
    // Gens 3 and 4 draw the thaw for such a move too; a draw that keeps the body frozen is overruled by the move: blocked
    if (shown.took !== 'blocked' || !/move followed/.test(shown.reason ?? '')) return [`${label}: ${why(shown)}`];
    tally.blocked++;
    return [];
  }
  const problems: string[] = [];
  if (shown.took !== 'applied') problems.push(`${label}: ${why(shown)}`);
  else tally.applied++;
  if (shown.chance === undefined || Math.abs(shown.chance - oracle) > 1e-9) problems.push(`${label}: chance ${shown.chance}, the simulator draws ${oracle}`);
  if (shown.logIndex === undefined) problems.push(`${label}: no log index`);
  if (!shows(battle, start, happens ? check.yes : check.no)) problems.push(`${label}: the protocol shows none of ${(happens ? check.yes : check.no).source}`);
  if (shows(battle, start, happens ? check.no : check.yes)) problems.push(`${label}: the protocol shows the other answer too`);
  return problems;
}

describe.each(SWEEP_CASES)('the status check sweep: $name', ({ rules, mode, name }) => {
  const tally: Tally = newTally();
  const checks = CHECKS.filter(check => rules.generation >= check.from);
  const moves = sweepSelection(CHECK_MOVES, 'moves');

  describe.each(checks.map(check => [check.id, check] as const))('%s', (_id, check) => {
    test.each(moves)('%s', moveId => {
      expect(exercise(rules, mode, check, moveId, tally), `${name} ${check.id} ${moveId}`).toEqual([]);
    });
  });

  test('the sweep exercised the checks', () => {
    summaries.push(`${name}: ${checks.length} checks ${JSON.stringify({ ...tally, bad: undefined, unexercised: undefined })}`);
    expect(tally.applied).toBeGreaterThan(checks.length * 4);
    // from Gen 5 on the move that thaws its user is a die that is never drawn; Gens 3 and 4 draw it and the move overrules a no
    if (rules.generation >= 5) expect(tally.noDraw).toBeGreaterThan(0);
    else if (rules.generation >= 3) expect(tally.blocked).toBeGreaterThan(0);
  });
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation <= 2))('the thaw of Gens 1 and 2 is no die of the turn: $name', ({ rules, mode }) => {
  test('a frozen body forced to thaw reads no-draw with the reason', () => {
    const board = sweepBoard(rules, 'tackle', mode);
    started(attacker(board).setStatus('frz'), 'freeze');
    const { report } = forcedOn(board, sweepClicks(mode, 'normal'), [dieOf('tackle', 'frz', true)]);
    expect(report.forced[0].took, why(report.forced[0])).toBe('no-draw');
    expect(report.forced[0].reason).toMatch(/did not use/);
  });
});

describe.each(SWEEP_CASES)('the confusion self-hit rolls its own damage: $name', ({ rules, mode, name }) => {
  test('forced to hit itself (the answer "no": the check stops the body), the damage roll steps rise; the check and the roll are two dice of one turn', () => {
    const board = sweepBoard(rules, 'tackle', mode);
    started(attacker(board).addVolatile('confusion'), 'confusion');
    const clicks = sweepClicks(mode, 'normal');
    const lost = (step: number): { loss: number; reports: DieReport[] } => {
      const roll: ForcedDie = { name: { slot: 'p1a', moveId: 'tackle', targetSlot: 'p1a', kind: 'damage-roll', effectId: 'confusion' }, result: { step } };
      const { report, battle } = forcedOn(board, clicks, [dieOf('tackle', 'confusion', false), roll]);
      const body = monOf(battle, 'p1a');
      return { loss: body.maxhp - body.hp, reports: report.forced };
    };
    const steps = rules.generation <= 2 ? 0 : 15;
    const low = lost(0);
    expect(low.reports[0].took, why(low.reports[0])).toBe('applied');
    summaries.push(`${name}: self-hit loss ${low.loss}`);
    if (rules.generation <= 2) {
      // Gens 1 and 2 have no self-hit roll: the die of it is never drawn
      expect(low.reports[1].took, why(low.reports[1])).toBe('no-draw');
      return;
    }
    const high = lost(steps);
    expect(low.reports[1].took, why(low.reports[1])).toBe('applied');
    expect(high.reports[1].took, why(high.reports[1])).toBe('applied');
    expect(high.loss).toBeGreaterThan(low.loss);
  });
});
