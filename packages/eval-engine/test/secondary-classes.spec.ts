import type { Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { createMatchupCache } from '../src/eval-function';
import { advancePositionWithLog } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { secondaryEffectId } from '../src/dice/recognize';
import { drawPair } from '../src/pair/draw';
import { SWEEPS_FULL, type Mode } from './dice-fixtures';
import {
  clicksAccepted, dexOfRules, effectShown, isCharge, isDelayed, outfitBoard, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, sweepTargets,
  type DexMove, type SecondaryEntry,
} from './dice-sweep-support';
import {
  entriesOf, FAST, handlerHolders, hasChanceEntry, liveOf, playedChances, readOn, rootOf, row, sameChances, toleranceOf,
} from './secondary-classes-support';

/**
 * Round 86 (T305), step A4: the red sweep of the secondary classes, part one (the reader and the scripts). Every generation 1 to
 * 9 and the Champions mod, singles and from Gen 3 doubles; a plain run plays the sample of `sweepSelection`, `DICE_SWEEPS=full`
 * every Dex move. The paths (class weights, scenes, fork counts) are in `secondary-classes-paths.spec.ts`; the contract of
 * the shapes is in `secondary-classes-support.ts`.
 *
 * Today the rows named in KNOWN fail, each for the reason of the plan (3.6, point 4): `dice/secondaries.ts` has no reader of the
 * entries a played move draws, and neither `ScriptedPRNG` nor `PairPRNG` answers a secondary die. The rows after the oracle
 * (the first describe) pass today: they show that the oracle sees the chances, so a row that is red is not red by a blind oracle.
 * `T305_RED=1` runs the KNOWN rows as plain tests.
 */
await loadSimMods('gen9championsou');

const aimed = (mode: Mode, move: DexMove): string => (mode === 'singles' ? '' : (['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : ''));
const choicesOf = (mode: Mode, move: DexMove): { p1: string; p2: string } => (mode === 'singles'
  ? { p1: `move ${move.id}`, p2: 'move splash' }
  : { p1: `move ${move.id}${aimed(mode, move)}, move splash`, p2: 'move splash, move splash' });

/** A move the oracle can play on a plain turn: no charge turn needed here, nothing that lands later. */
const playable = (move: DexMove): boolean => !isDelayed(move) && !isCharge(move);

describe.each(SWEEP_CASES)('the oracle sees the entries of a played move: $name', ({ rules, mode }) => {
  const board = (ability?: string): Battle => outfitBoard(rules, mode, { species: FAST, moves: ['flamethrower'] }, { species: 'Vaporeon', ...(ability ? { ability } : {}) });

  test('Flamethrower draws one burn die of 10 percent for the foe it hits', () => {
    const seen = playedChances(board(), sweepClicks(mode, 'normal'), ['p2a']).get('p2a');
    expect(seen, `${rules.name} ${mode}`).toBeDefined();
    expect(sameChances(seen!, [{ effectId: 'brn', chance: 0.1 }], toleranceOf(rules))).toBeNull();
  });

  test('a target with Shield Dust draws no die (Gens 3 and up)', () => {
    if (rules.generation < 3 || !dexOfRules(rules).abilities.get('shielddust').exists) return;
    const seen = playedChances(board('Shield Dust'), sweepClicks(mode, 'normal'), ['p2a']).get('p2a');
    expect(seen).toEqual([]);
  });
});

describe.each(SWEEP_CASES)('the reader against the simulator: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => hasChanceEntry(move) && !isDelayed(move));
  let exercised = 0;

  /** The problem of one move on one board, or null; a board where no target took damage on any seed is not counted. */
  function problem(first: Battle, move: DexMove, label: string): string | null {
    const slots = sweepTargets(mode, move.target);
    // a charge move is read on its second turn, the one that draws
    const { live: board, clicks } = liveOf(first, move, sweepClicks(mode, move.target), sweepClicks(mode, move.target, true));
    if (!clicksAccepted(board, clicks)) return null;
    const played = playedChances(board, clicks, slots, !!move.multihit);
    if (played.size === 0) return null;
    exercised++;
    for (const [slot, want] of played) {
      const { chances, unchanged } = readOn(board, move.id, slot);
      if (!unchanged) return `${label} ${slot}: the reader changed the live battle`;
      const differs = sameChances(chances, want, toleranceOf(rules));
      if (differs) return `${label} ${slot}: ${differs}`;
    }
    return null;
  }

  row('reader')(`${name}: every move with a chance entry, no outfit`, () => {
    const before = exercised;
    const problems = moves.map(move => problem(sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST), move, move.id)).filter(Boolean);
    expect(problems.join(' | ')).toBe('');
    expect(exercised).toBeGreaterThan(before);
  });

  const outfitted = SWEEPS_FULL ? moves : moves.slice(0, 6);
  const kinds = [['abilities', rules.generation >= 3], ['items', rules.generation >= 2]] as const;
  for (const [kind, present] of kinds) {
    if (!present) continue;
    for (const side of ['user', 'target'] as const) {
      row('reader-outfit')(`${name}: ${side} ${kind} with a handler that can touch a secondary`, () => {
        const before = exercised;
        const problems: (string | null)[] = [];
        for (const holder of handlerHolders(rules, kind)) {
          const own = kind === 'abilities' ? { ability: holder } : { item: holder };
          for (const move of outfitted) {
            const board = outfitBoard(
              rules, mode,
              { species: FAST, moves: [move.id], ...(side === 'user' ? own : {}) },
              { species: 'Vaporeon', ...(side === 'target' ? own : {}) },
            );
            problems.push(problem(board, move, `${side} ${holder} ${move.id}`));
          }
        }
        expect(problems.filter(Boolean).join(' | ')).toBe('');
        expect(exercised).toBeGreaterThan(before);
      });
    }
  }
});

/** The log of one scripted turn: the script answers the move's hit, crit and roll and the entry (and the others of the move) as asked. */
function scriptedLog(mode: Mode, move: DexMove, board: Battle, secondary: Record<string, boolean>): string[] {
  const script = { hit: true, crit: false, roll: 7, secondary };
  const choices = choicesOf(mode, move);
  if (mode === 'singles') {
    return advancePositionWithLog(rootOf(board), choices.p1, choices.p2, '1,2,3,4', { scripts: new Map([[`p1:${move.id}`, script]]) as never }).log;
  }
  return drawPair(rootOf(board), choices.p1, choices.p2, '1,2,3,4', new Map([[`p1a:${move.id}>p2a`, script]]) as never, createMatchupCache()).log;
}

/** An entry whose effect the protocol shows by a standard line (a status, a flinch, a drop of the target's stats). */
const witnessed = (entry: SecondaryEntry): boolean =>
  entry.chance !== undefined && entry.chance < 100 && !entry.self && !!(entry.status || entry.volatileStatus === 'flinch' || entry.boosts);

describe.each(SWEEP_CASES)('a script answers the secondary die: $name', ({ rules, mode, name }) => {
  // multi-hit moves draw the entry at every hit (Twineedle, Double Iron Bash): a script answers it once per effect, a rest for the gate
  const { moves } = sweepMoves(rules, move => entriesOf(move).some(witnessed) && playable(move) && move.priority >= 0 && !move.multihit);
  const target = (['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent'] as const);

  row(mode === 'singles' ? 'script-singles' : 'script-doubles')(`${name}: yes shows the effect, no does not, the others of the move stay off`, () => {
    const problems: string[] = [];
    let scripted = 0;
    for (const move of moves.filter(candidate => (target as readonly string[]).includes(candidate.target))) {
      const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
      if (!clicksAccepted(board, sweepClicks(mode, move.target))) continue;
      const entries = entriesOf(move).filter(witnessed);
      for (const entry of entries) {
        const id = secondaryEffectId(entry);
        for (const happens of [true, false]) {
          const secondary = Object.fromEntries(entriesOf(move).filter(other => other.chance !== undefined && other.chance < 100).map(other => [secondaryEffectId(other), false]));
          secondary[id] = happens;
          const log = scriptedLog(mode, move, board, secondary);
          // a move that fails (Snore awake) draws no die
          if (!log.some(line => line.startsWith('|-damage|p2a:'))) continue;
          scripted++;
          const shown = effectShown({ log } as unknown as Battle, 0, entry, 'p2a', 'p1a') && !log.some(line => line.startsWith('|-miss|') && (line.split('|')[3] === undefined || line.split('|')[3].startsWith('p2a:')));
          if (shown !== happens) problems.push(`${move.id} ${id} ${happens ? 'yes' : 'no'}: the protocol shows ${shown ? 'the effect' : 'no effect'}`);
        }
      }
    }
    expect(problems.join(' | ')).toBe('');
    expect(scripted).toBeGreaterThan(0);
  });
});
