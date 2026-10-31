import { writeFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { secondaryEffectId } from '../src/dice/recognize';
import type { DieReport } from '../src/dice/types';
import { playClicks, type Mode, type Rules } from './dice-fixtures';
import {
  clicksAccepted, dexOfRules, dieOf, effectShown, explained, forcedOn, isCharge, missesOf, newTally, outfitBoard, picksOne, SWEEP_CASES, sweepBoard, sweepClicks,
  sweepMoves, sweepTargets, VGC_RULES, type DexMove, type SecondaryEntry, type Tally,
} from './dice-sweep-support';

// Round 82 (forced dice), lane A3a: the secondary sweep. Every move with a secondary entry, singles and doubles with every
// target on its own, each entry its own die (Fire Fang's burn and flinch), the accuracy forced to hit so the entry is drawn,
// then the entry forced to happen and not to. The attacker is faster than the foe so a flinch can land. The report is held
// against an independent witness of the protocol (`effectShown`). The rule rows follow: King's Rock and Razor Fang add a
// flinch, Serene Grace doubles the chance the report names, Shield Dust, Covert Cloak and Sheer Force remove the entries
// (`no-draw` with the reason), a Substitute takes the hit. The self effect with a chance closes the file.
await loadSimMods('gen9championsou');

const FAST = 'Pikachu';

const entriesOf = (move: DexMove): SecondaryEntry[] => ((move as unknown as { secondaries?: SecondaryEntry[] }).secondaries ?? []);
const why = (report: DieReport): string => report.reason ?? 'no reason';

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const hit = (name: string, slot: string) => ({ name: dieOf(name, slot, 'accuracy'), result: { happens: true } });
const secondaryOf = (moveId: string, slot: string, entry: SecondaryEntry) => ({
  ...dieOf(moveId, slot, 'secondary'), effectId: secondaryEffectId(entry),
});

/** What the witness cannot tell: an entry it cannot see, and a self effect that a second target's draw can also give. */
interface Blind { opaque: boolean; shared: boolean }

function noChanceProblem(report: DieReport, happens: boolean, shown: boolean, blind: Blind): string | null {
  // a sure entry cannot be forced not to happen, an entry with chance 0 (Chatter in Gen 4) cannot be forced to happen
  const sure = !happens && (((report.chance ?? 0) >= 1 && (shown || blind.opaque)) || (shown && blind.shared));
  const never = happens && report.chance === 0 && !shown;
  return (sure || never) && report.reason ? null : `no-chance: chance ${report.chance}, effect ${shown}, ${why(report)}`;
}

/** The problem with a report of a forced secondary, or null when the report and the protocol agree. */
function problemOf(report: DieReport, happens: boolean, shown: boolean, blind: Blind): string | null {
  switch (report.took) {
    case 'applied': return happens === shown ? null : `applied but the protocol ${shown ? 'shows' : 'shows no'} effect`;
    case 'blocked': return happens && !shown && report.reason ? null : `blocked: ${why(report)} (effect ${shown})`;
    case 'no-chance': return noChanceProblem(report, happens, shown, blind);
    case 'no-draw': return !shown && explained(report.reason) ? null : `no-draw: ${why(report)} (effect ${shown})`;
  }
}

const verdictKey = (took: DieReport['took']): keyof Tally =>
  took === 'no-chance' ? 'noChance' : took === 'applied' ? 'applied' : took === 'blocked' ? 'blocked' : 'noDraw';

interface Case { mode: Mode; move: DexMove; board: Battle; clicks: { p1: string; p2: string }; tally: Tally }

/** Forces one entry to happen or not on every slot it can draw for; the problems found. */
function forceEntry({ mode, move, board, clicks, tally }: Case, entry: SecondaryEntry, happens: boolean): string[] {
  const id = secondaryEffectId(entry);
  const verdicts: { slot: string; report: DieReport; problem: string | null }[] = [];
  for (const slot of sweepTargets(mode, move.target)) {
    const { report, battle, start } = forcedOn(board, clicks, [hit(move.id, slot), { name: secondaryOf(move.id, slot, entry), result: { happens } }]);
    const forced = report.forced[1];
    tally.cases++;
    const shown = effectShown(battle, start, entry, slot, 'p1a') && missesOf(battle, start, slot) === 0;
    const blind: Blind = {
      // an entry whose effect the protocol does not show by a standard line (a handler, a condition with no start line)
      opaque: id === 'effect' || (!!entry.volatileStatus && id !== 'flinch'),
      shared: !!entry.self && sweepTargets(mode, move.target).length > 1,
    };
    const problem = move.flags.futuremove
      ? (forced.took === 'no-draw' && /two turns later/.test(forced.reason ?? '') ? null : `future move: ${forced.took}`)
      : problemOf(forced, happens, shown, blind);
    verdicts.push({ slot, report: forced, problem });
  }
  // a move that picks one target draws for that one only
  const settled = picksOne(move.target) && verdicts.some(verdict => verdict.report.took !== 'no-draw' && !verdict.problem);
  const problems: string[] = [];
  for (const verdict of verdicts) {
    if (settled && verdict.report.took === 'no-draw') continue;
    if (verdict.problem) problems.push(`${id} ${happens ? 'yes' : 'no'} ${verdict.slot}: ${verdict.problem}`);
    else tally[verdictKey(verdict.report.took)]++;
  }
  return problems;
}

/** Forces every entry of one move to happen and not to; the problems found. */
function exercise(rules: Rules, mode: Mode, move: DexMove, tally: Tally, vgc = false): string[] {
  const board = sweepBoard(rules, move.id, mode, '1,2,3,4', vgc, FAST);
  let clicks = sweepClicks(mode, move.target);
  if (isCharge(move)) {
    playClicks(board, clicks);
    clicks = sweepClicks(mode, move.target, true);
  }
  if (!clicksAccepted(board, clicks)) {
    tally.unexercised.push(move.id);
    return [];
  }
  const seen = new Set<string>();
  const entries = entriesOf(move).filter(entry => !seen.has(secondaryEffectId(entry)) && !!seen.add(secondaryEffectId(entry)));
  return entries.flatMap(entry => [true, false].flatMap(happens => forceEntry({ mode, move, board, clicks, tally }, entry, happens)));
}

function conclude(name: string, moves: DexMove[], skipped: number, tally: Tally): void {
  summaries.push(`${name}: ${moves.length} moves (${skipped} skipped: no foe as target) ${JSON.stringify({ ...tally, bad: undefined, unexercised: tally.unexercised.join(',') })}`);
  expect(tally.unexercised.length, `clicks refused: ${tally.unexercised}`).toBeLessThan(moves.length * 0.05 + 1);
  expect(tally.cases).toBeGreaterThanOrEqual(moves.length);
  expect(tally.applied).toBeGreaterThan(tally.cases * 0.5);
}

describe.each(SWEEP_CASES)('the secondary sweep: $name', ({ rules, mode, name }) => {
  const { moves, skipped } = sweepMoves(rules, move => entriesOf(move).length > 0);
  const tally: Tally = newTally();

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, mode, move, tally), `${rules.name} ${mode} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => conclude(name, moves, skipped, tally));
});

describe.each(VGC_RULES.map(rules => ({ rules, name: `${rules.name} VGC` })))('the secondary sweep, a team of six: $name', ({ rules, name }) => {
  // every tenth move keeps the row short; the dice behave as in doubles, the row exists because VGC counts on its own
  const { moves, skipped } = sweepMoves(rules, move => entriesOf(move).length > 0);
  const some = moves.filter((_, index) => index % 10 === 0);
  const tally: Tally = newTally();

  test.each(some.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, 'doubles', move, tally, true), `${name} ${move.id}`).toEqual([]);
  });

  test('the sweep exercised the moves', () => conclude(name, some, skipped, tally));
});

/** One forced secondary of a move on an outfitted board: the report and whether the effect shows. */
function forcedEntry(
  rules: Rules, mode: Mode, a: Parameters<typeof outfitBoard>[2], t: Parameters<typeof outfitBoard>[3], entry: SecondaryEntry, happens: boolean,
) {
  const board = outfitBoard(rules, mode, a, t);
  const clicks = sweepClicks(mode, 'normal');
  const move = a.moves[0];
  const { report, battle, start } = forcedOn(board, clicks, [hit(move, 'p2a'), { name: secondaryOf(move, 'p2a', entry), result: { happens } }]);
  return { report: report.forced[1], shown: effectShown(battle, start, entry, 'p2a', 'p1a') && missesOf(battle, start, 'p2a') === 0, battle, start };
}

/** Whether the rule set has the item or ability (the Dex of the game decides). */
const has = (rules: Rules, kind: 'items' | 'abilities', id: string): boolean => {
  const dex = dexOfRules(rules);
  const entry = dex[kind].get(id);
  return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
};

const FLINCH: SecondaryEntry = { chance: 10, volatileStatus: 'flinch' };
/** How often each rule row played (a row that returns early for a rule set the item or ability does not exist in is no row there). */
const played = new Map<string, number>();
const play = (row: string): void => void played.set(row, (played.get(row) ?? 0) + 1);

describe.each(SWEEP_CASES)('the secondary rules: $name', ({ rules, mode }) => {
  const FACES = [['kingsrock', 2], ['razorfang', 4]] as const;

  test.each(FACES)('%s adds a flinch to a move with no secondary: the die exists, yes flinches, no does not', (item, firstGen) => {
    if (rules.generation < firstGen || !has(rules, 'items', item)) return;
    play(item);
    for (const happens of [true, false]) {
      const forced = forcedEntry(rules, mode, { species: FAST, moves: ['tackle'], item }, { species: 'Vaporeon' }, FLINCH, happens);
      if (forced.report.took === 'no-draw') {
        // a King's Rock flinch needs a target that has not moved; a drawn die never reads no-draw here
        expect(forced.report.reason, `${item} ${happens}`).toMatch(/shows "/);
        continue;
      }
      expect(forced.report.took, `${item} ${happens}: ${why(forced.report)}`).toBe('applied');
      expect(forced.shown).toBe(happens);
      expect(forced.report.chance).toBeGreaterThan(0);
      expect(forced.report.chance).toBeLessThan(0.5);
    }
  });

  test('Serene Grace doubles the chance the report names', () => {
    if (rules.generation < 3 || !has(rules, 'abilities', 'serenegrace')) return;
    play('serenegrace');
    const entry: SecondaryEntry = { chance: 10, status: 'par' };
    const plain = forcedEntry(rules, mode, { species: FAST, moves: ['thunderbolt'] }, { species: 'Vaporeon' }, entry, true);
    const doubled = forcedEntry(rules, mode, { species: FAST, moves: ['thunderbolt'], ability: 'Serene Grace' }, { species: 'Vaporeon' }, entry, true);
    expect(plain.report.took, why(plain.report)).toBe('applied');
    expect(doubled.report.took, why(doubled.report)).toBe('applied');
    expect(doubled.report.chance).toBeCloseTo((plain.report.chance ?? 0) * 2, 5);
    expect(doubled.shown).toBe(true);
  });

  test.each([
    ['shielddust', 3, 'target', 'ability'], ['covertcloak', 9, 'target', 'item'], ['sheerforce', 5, 'user', 'ability'],
  ] as const)('%s leaves no entry to draw: both answers are no draw with the reason', (id, firstGen, holder, kind) => {
    if (rules.generation < firstGen || !has(rules, kind === 'ability' ? 'abilities' : 'items', id)) return;
    play(id);
    const outfit = kind === 'ability' ? { ability: dexOfRules(rules).abilities.get(id).name } : { item: dexOfRules(rules).items.get(id).name };
    const entry: SecondaryEntry = { chance: 10, status: 'par' };
    for (const happens of [true, false]) {
      const forced = holder === 'target'
        ? forcedEntry(rules, mode, { species: FAST, moves: ['thunderbolt'] }, { species: 'Vaporeon', ...outfit }, entry, happens)
        : forcedEntry(rules, mode, { species: FAST, moves: ['thunderbolt'], ...outfit }, { species: 'Vaporeon' }, entry, happens);
      expect(forced.report.took, `${id} ${happens}: ${why(forced.report)}`).toBe('no-draw');
      expect(forced.report.reason, id).toMatch(/removed the secondary/);
      expect(forced.shown).toBe(false);
    }
  });

  test('a Substitute takes the hit: the entry is never applied and the report says why', () => {
    play('substitute');
    const entry: SecondaryEntry = { chance: 10, status: 'par' };
    for (const happens of [true, false]) {
      const board = outfitBoard(rules, mode, { species: FAST, moves: ['thunderbolt'] }, { species: 'Vaporeon' });
      (board.sides[1].active[0] as unknown as { addVolatile(id: string): unknown }).addVolatile('substitute');
      const { report, battle, start } = forcedOn(board, sweepClicks(mode, 'normal'), [hit('thunderbolt', 'p2a'), { name: secondaryOf('thunderbolt', 'p2a', entry), result: { happens } }]);
      const shown = effectShown(battle, start, entry, 'p2a', 'p1a');
      expect(shown, `${rules.name} ${happens}`).toBe(false);
      expect(report.forced[1].took === 'applied' && happens, why(report.forced[1])).toBe(false);
      // a forced no that nothing contradicts is plainly applied; every other answer says why it did not show
      if (!(report.forced[1].took === 'applied' && !happens)) expect(report.forced[1].reason, `${rules.name} ${happens} ${report.forced[1].took}`).toBeTruthy();
    }
  });
});

describe.each(SWEEP_CASES)('the self effect with a chance: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, move => !!(move as unknown as { self?: { boosts?: object } }).self?.boosts && move.category !== 'Status');

  test('the self effect is its own die: yes shows the boost on the user, no does not, a move without a chance has no way to say no', () => {
    let seenDraws = 0;
    for (const move of moves) {
      const self = (move as unknown as { self: { boosts: Record<string, number>; chance?: number } }).self;
      const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
      let clicks = sweepClicks(mode, move.target);
      if (isCharge(move)) {
        playClicks(board, clicks);
        clicks = sweepClicks(mode, move.target, true);
      }
      if (!clicksAccepted(board, clicks) || move.flags.futuremove) continue;
      for (const happens of [true, false]) {
        const slot = sweepTargets(mode, move.target)[0];
        const { report, battle, start } = forcedOn(board, clicks, [hit(move.id, slot), { name: { slot: 'p1a', moveId: move.id, kind: 'self-effect' }, result: { happens } }]);
        const forced = report.forced[1];
        if (missesOf(battle, start, slot) > 0) continue;
        const shown = effectShown(battle, start, { self }, slot, 'p1a');
        if (forced.took === 'no-draw') {
          expect(explained(forced.reason) || /drew no self-effect/.test(forced.reason ?? ''), `${move.id}: ${why(forced)}`).toBe(true);
          continue;
        }
        seenDraws++;
        if (forced.took === 'no-chance') expect(!happens && shown, `${move.id}: ${why(forced)}`).toBe(true);
        else expect(forced.took === 'applied' ? shown === happens : !shown && happens, `${move.id} ${happens} ${forced.took}: ${why(forced)}`).toBe(true);
      }
    }
    if (moves.length > 0 && rules.generation >= 3) expect(seenDraws).toBeGreaterThan(0);
  });
});

describe('the rule rows played', () => {
  test.each(['kingsrock', 'razorfang', 'serenegrace', 'shielddust', 'covertcloak', 'sheerforce', 'substitute'])('%s', row => {
    expect(played.get(row) ?? 0, row).toBeGreaterThan(0);
  });
});
