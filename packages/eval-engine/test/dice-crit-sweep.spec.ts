import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport } from '../src/dice/types';
import { mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import {
  clicksAccepted, critsOf, dieOf, explained, forcedOn, isCharge, missesOf, newTally, picksOne, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves,
  sweepTargets, VGC_RULES, type DexMove, type Tally,
} from './dice-sweep-support';

// Round 82 (forced dice), lane A2b: the crit sweep. Every damaging move that can crit (no fixed damage, no OHKO, no damage
// callback, no sure crit), singles and doubles with every target on its own, with the accuracy forced to hit so the crit is
// drawn, forced to crit and forced not to. The report is held against the protocol's `|-crit|` line. The rows that have no
// chance: a move that always crits, a move that deals fixed damage, a target that blocks the crit, a sure crit by the
// crit stage.
await loadSimMods('gen9championsou');

const damageCallback = (move: DexMove): boolean => !!(move as unknown as { damageCallback?: unknown }).damageCallback;
const fixedDamage = (move: DexMove): boolean => !!move.damage || !!move.ohko || damageCallback(move);
const canCrit = (move: DexMove): boolean => move.category !== 'Status' && !move.willCrit && !fixedDamage(move) && move.basePower !== 0;

/** The reason of a report, or the word that it has none (a report that must have one fails with this). */
const why = (report: DieReport): string => report.reason ?? 'no reason';

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const hit = (name: string, slot: string) => ({ name: dieOf(name, slot, 'accuracy'), result: { happens: true } });

/** The problem with a report of a forced crit, or null when the report and the protocol agree. */
function problemOf(report: DieReport, happens: boolean, crits: number, misses: number): string | null {
  switch (report.took) {
    case 'applied': return (happens ? crits >= 1 : crits === 0) ? null : `applied but the protocol shows ${crits} crits`;
    case 'blocked': return happens && crits === 0 && report.reason ? null : `blocked: ${why(report)} (${crits} crits)`;
    case 'no-chance': return !happens && (report.chance ?? 0) >= 1 && crits >= 1 && report.reason ? null : `no-chance: chance ${report.chance}, ${crits} crits, ${why(report)}`;
    case 'no-draw': return crits === 0 && misses === 0 && explained(report.reason) ? null : `no-draw: ${why(report)} (${crits} crits, ${misses} misses)`;
  }
}

/** Forces the crit of one move to happen and not to, with the accuracy forced to hit, on every slot it can draw for; the problems found. */
function exercise(rules: Rules, mode: Mode, move: DexMove, tally: Tally, vgc = false): string[] {
  const board = sweepBoard(rules, move.id, mode, '1,2,3,4', vgc);
  let clicks = sweepClicks(mode, move.target);
  if (isCharge(move)) {
    playClicks(board, clicks);
    clicks = sweepClicks(mode, move.target, true);
  }
  if (!clicksAccepted(board, clicks)) {
    tally.unexercised.push(move.id);
    return [];
  }
  const problems: string[] = [];
  for (const happens of [true, false]) {
    const verdicts: { slot: string; report: DieReport; problem: string | null }[] = [];
    for (const slot of sweepTargets(mode, move.target)) {
      const { report, battle, start } = forcedOn(board, clicks, [hit(move.id, slot), { name: dieOf(move.id, slot, 'crit'), result: { happens } }]);
      const shown = report.forced[1];
      tally.cases++;
      const problem = move.flags.futuremove
        ? (shown.took === 'no-draw' && /two turns later/.test(shown.reason ?? '') ? null : `future move: ${shown.took}`)
        : problemOf(shown, happens, critsOf(battle, start, slot), missesOf(battle, start, slot));
      verdicts.push({ slot, report: shown, problem });
    }
    // a move that picks one target draws for that one only
    const settled = picksOne(move.target) && verdicts.some(verdict => verdict.report.took !== 'no-draw' && !verdict.problem);
    for (const verdict of verdicts) {
      if (settled && verdict.report.took === 'no-draw') continue;
      if (verdict.problem) problems.push(`${happens ? 'yes' : 'no'} ${verdict.slot}: ${verdict.problem}`);
      else tally[verdict.report.took === 'no-chance' ? 'noChance' : verdict.report.took === 'applied' ? 'applied' : verdict.report.took === 'blocked' ? 'blocked' : 'noDraw']++;
    }
  }
  return problems;
}

function conclude(name: string, moves: DexMove[], skipped: number, tally: Tally): void {
  summaries.push(`${name}: ${moves.length} moves (${skipped} skipped: no foe as target) ${JSON.stringify({ ...tally, bad: undefined, unexercised: tally.unexercised.join(',') })}`);
  expect(tally.unexercised.length, `clicks refused: ${tally.unexercised}`).toBeLessThan(moves.length * 0.02);
  expect(tally.cases).toBeGreaterThan(moves.length);
  expect(tally.applied).toBeGreaterThan(tally.cases * 0.8);
}

describe.each(SWEEP_CASES)('the crit sweep: $name', ({ rules, mode, name }) => {
  const { moves, skipped } = sweepMoves(rules, canCrit);
  const tally: Tally = newTally();

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, mode, move, tally), `${rules.name} ${mode} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => conclude(name, moves, skipped, tally));
});

describe.each(VGC_RULES.map(rules => ({ rules, name: `${rules.name} VGC` })))('the crit sweep, a team of six: $name', ({ rules, name }) => {
  // every tenth move keeps the row short; the dice behave as in doubles, the row exists because VGC counts on its own
  const { moves, skipped } = sweepMoves(rules, canCrit);
  const some = moves.filter((_, index) => index % 10 === 0);
  const tally: Tally = newTally();

  test.each(some.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, 'doubles', move, tally, true), `${name} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => conclude(name, some, skipped, tally));
});

describe.each(SWEEP_CASES)('the crit rows with no chance: $name', ({ rules, mode }) => {
  const dexMoves = (keep: (move: DexMove) => boolean): DexMove[] => sweepMoves(rules, move => move.category !== 'Status' && keep(move)).moves;

  test('a move that always crits draws no crit: both answers are no chance and the crit shows', () => {
    for (const move of dexMoves(candidate => !!candidate.willCrit)) {
      const board = sweepBoard(rules, move.id, mode);
      const clicks = sweepClicks(mode, move.target);
      if (isCharge(move) || !clicksAccepted(board, clicks)) continue;
      for (const happens of [true, false]) {
        const slot = sweepTargets(mode, move.target)[0];
        const { report, battle, start } = forcedOn(board, clicks, [hit(move.id, slot), { name: dieOf(move.id, slot, 'crit'), result: { happens } }]);
        if (missesOf(battle, start, slot) > 0) continue;
        expect(report.forced[1].took, `${move.id} ${happens}`).toBe('no-chance');
        expect(critsOf(battle, start, slot), move.id).toBeGreaterThan(0);
      }
    }
  });

  test('a move that deals fixed damage, an OHKO or a damage callback draws no crit: the report says no draw and no crit shows', () => {
    const fixed = dexMoves(candidate => fixedDamage(candidate) && !candidate.flags.futuremove);
    let played = 0;
    for (const move of fixed) {
      const board = sweepBoard(rules, move.id, mode);
      const clicks = sweepClicks(mode, move.target);
      if (isCharge(move) || !clicksAccepted(board, clicks)) continue;
      const slot = sweepTargets(mode, move.target)[0];
      const { report, battle, start } = forcedOn(board, clicks, [hit(move.id, slot), { name: dieOf(move.id, slot, 'crit'), result: { happens: true } }]);
      expect(report.forced[1].took, move.id).toBe('no-draw');
      expect(critsOf(battle, start, slot), move.id).toBe(0);
      played++;
    }
    expect(played).toBeGreaterThan(0);
  });
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('the crit rows of a target and an attacker: $name', ({ rules, mode }) => {
  const outfit = (rules: Rules) => ({ level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });

  /** A board where side p2's lead has the given species and ability (Gens 3 and up). */
  function board(moveId: string, species: string, ability: string, mode: Mode, item = '') {
    const attacker = set('Snorlax', [moveId], { ...outfit(rules), gender: 'M', item });
    const foe = set(species, ['splash'], { ...outfit(rules), ability, gender: 'F' });
    if (mode === 'singles') return battleOf(rules.singles, [attacker], [foe]);
    return battleOf(rules.doubles!, [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
  }

  test.each([['Cloyster', 'Shell Armor'], ['Armaldo', 'Battle Armor']])('%s with %s blocks a forced crit and shows none when forced not to', (species, ability) => {
    for (const move of ['tackle', 'slash', 'surf']) {
      for (const happens of [true, false]) {
        const live = board(move, species, ability, mode);
        const clicks = sweepClicks(mode, move === 'surf' ? 'allAdjacent' : 'normal');
        const slot = 'p2a';
        const report = forcedOn(live, clicks, [hit(move, slot), { name: dieOf(move, slot, 'crit'), result: { happens } }]);
        const shown = report.report.forced[1];
        expect(critsOf(report.battle, report.start, slot), `${move} ${happens}`).toBe(0);
        if (missesOf(report.battle, report.start, slot) > 0) continue;
        expect(shown.took, `${move} ${happens}`).toBe(happens ? 'blocked' : 'applied');
      }
    }
  });

  test('a crit stage that makes the crit sure: no is no chance exactly when the crit shows', () => {
    const live = board('slash', 'Vaporeon', 'No Ability', mode, 'Scope Lens');
    (live.sides[0].active[0] as unknown as { addVolatile(id: string): unknown }).addVolatile('focusenergy');
    const clicks = sweepClicks(mode, 'normal');
    const slot = 'p2a';
    const forcedNo = forcedOn(live, clicks, [hit('slash', slot), { name: dieOf('slash', slot, 'crit'), result: { happens: false } }]);
    const sure = critsOf(forcedNo.battle, forcedNo.start, slot) > 0;
    expect(forcedNo.report.forced[1].took === 'no-chance').toBe(sure);
    // a forced crit shows in every case
    const forcedYes = forcedOn(live, clicks, [hit('slash', slot), { name: dieOf('slash', slot, 'crit'), result: { happens: true } }]);
    expect(critsOf(forcedYes.battle, forcedYes.start, slot)).toBeGreaterThan(0);
    expect(forcedYes.report.forced[1].took).toBe('applied');
  });
});
