import { appendFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { advancePositionWithLog } from '../src/forward-model';
import { QuantileSink } from '../src/forward/scripted-prng';
import { loadSimMods } from '../src/forward/sim-mods';
import { secondaryEffectId } from '../src/dice/recognize';
import type { DieName, Draw } from '../src/dice/types';
import { drawKeyed } from '../src/pair/draw';
import { cellHash, RootQuantiles, rootSalt, type DieQuantiles } from '../src/search/root-quantile';
import { SWEEPS_FULL, seedOf, standing, type Mode } from './dice-fixtures';
import {
  clicksAccepted, critsOf, dexOfRules, effectShown, missesOf, outfitBoard, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves,
  type DexMove, type SecondaryEntry,
} from './dice-sweep-support';
import { entriesOf, FAST, liveOf, rootOf, toleranceOf } from './secondary-classes-support';

/**
 * Round 89 (#59, T322 block 1), A3 stage 1: the sweep of the root quantiles over the Dex. Every move with an accuracy, a secondary
 * chance, a hit count or a status and duration die, read from the Dex of the rule set (never by name), in every generation 1 to 9 and
 * the Champions mod, singles and from Gen 3 doubles, also with Serene Grace and Sheer Force on the attacker. Per move, case and
 * outfit: 16 roots times the 4 trees of a search draw the move's turn under the quantiles through the singles path
 * (`advancePositionWithLog` with a `QuantileSink`, the `ScriptedPRNG`) or the doubles path (`drawKeyed`, the `PairPRNG`). A plain run
 * plays the sample of `sweepSelection`, `DICE_SWEEPS=full` every Dex move.
 *
 * (b1) a draw in which the quantiles answered no die is the plain draw of its seed, line for line; (b2) no draw throws or shows an
 * `|error|` line; (b3) `standing` (`fingerprint` of `power-oracle.ts` and the turn state) of the live board is the same after the
 * draws; (b4) per case, the outcomes the battle shows (the miss and crit lines, the secondary's effect lines) of the dice the
 * quantiles answered, pooled per die kind and chance bucket, lie within 4.5 standard errors of the simulator's chance (the hash is
 * deterministic: a 4 SE miss shows every run); (b5) Sheer Force leaves the quantiles no secondary die to answer; (b6) the reported
 * scene: Iron Head's 30 percent flinch (Doubles OU 2694111300 t13, singles too) comes true in one or two of the four trees, never in
 * none of them and never in three.
 */
await loadSimMods('gen9championsou');

const TREES = 4;
const ROOTS = 16;
const hasCondition = (move: DexMove): boolean => !!(move.status || move.volatileStatus || move.sideCondition || move.slotCondition || move.pseudoWeather || move.weather || move.terrain);
/** A move that can draw a die under 100 percent: an accuracy, a secondary chance, a variable hit count, or a condition (its duration die). */
const drawsDie = (move: DexMove): boolean =>
  (typeof move.accuracy === 'number' && move.accuracy < 100)
  || entriesOf(move).some(entry => entry.chance !== undefined && entry.chance < 100)
  || (Array.isArray(move.multihit) && move.multihit[0] !== move.multihit[1])
  || hasCondition(move);
const chanceEntry = (move: DexMove): boolean => entriesOf(move).some(entry => entry.chance !== undefined && entry.chance < 100);
/** An entry whose effect the protocol shows by a standard line, and which the move draws once. */
const witnessed = (entry: SecondaryEntry): boolean => entry.chance !== undefined && entry.chance < 100 && !entry.self && !!(entry.status || entry.volatileStatus === 'flinch' || entry.boosts);

/** The quantiles under test with a record of the dice they answered. */
class Spy implements DieQuantiles {
  readonly answered: { name: DieName; draw: Draw }[] = [];
  private readonly inner: RootQuantiles;
  constructor(inner: RootQuantiles) {
    this.inner = inner;
  }
  answer(name: DieName, draw: Draw): number | boolean | undefined {
    const result = this.inner.answer(name, draw);
    if (result !== undefined) this.answered.push({ name, draw });
    return result;
  }
}

interface Pool { n: number; chances: number; variance: number; came: number }
const BUCKETS = [0.05, 0.15, 0.3, 0.5, 0.8, 1.01];
const bucketOf = (p: number): number => BUCKETS.findIndex(top => p < top);

class Tally {
  readonly pools = new Map<string, Pool>();
  add(kind: string, p: number, came: boolean): void {
    const key = `${kind} ${bucketOf(p)}`;
    const pool = this.pools.get(key) ?? { n: 0, chances: 0, variance: 0, came: 0 };
    pool.n++;
    pool.chances += p;
    pool.variance += p * (1 - p);
    pool.came += came ? 1 : 0;
    this.pools.set(key, pool);
  }
  /** The pools whose count is further than 4.5 standard errors (and the rule set's tolerance per die) from the chances. */
  problems(tolerance: number): string[] {
    const out: string[] = [];
    for (const [key, pool] of this.pools) {
      if (pool.n < 30) continue;
      const limit = 4.5 * Math.sqrt(Math.max(pool.variance, 0.25)) + tolerance * pool.n;
      if (Math.abs(pool.came - pool.chances) > limit) out.push(`${key}: ${pool.came} of ${pool.n} came, ${pool.chances.toFixed(1)} expected (limit ${limit.toFixed(1)})`);
    }
    return out;
  }
}

const chanceOfDraw = (draw: Draw): number | null =>
  draw.call === 'chance' ? (draw.from ? (draw.numerator ?? 0) / draw.from : null) : (draw.chance ?? null);

interface Fork { log: string[]; spy: Spy }

/** One root draw of a cell under the quantiles of tree `offset` of root `root`, through the PRNG of the case's game type. */
function fork(mode: Mode, position: ReturnType<typeof rootOf>, clicks: { p1: string; p2: string }, root: number, offset: number): Fork {
  const spy = new Spy(new RootQuantiles(cellHash(root, clicks.p1, clicks.p2), offset, TREES));
  const seed = seedOf(root) as never;
  if (mode === 'singles') {
    return { log: advancePositionWithLog(position, clicks.p1, clicks.p2, seed, { scripts: new QuantileSink(spy) }).log, spy };
  }
  return { log: drawKeyed(position, clicks.p1, clicks.p2, seed, false, spy).log, spy };
}

function plainLog(mode: Mode, position: ReturnType<typeof rootOf>, clicks: { p1: string; p2: string }, root: number): string[] {
  const seed = seedOf(root) as never;
  if (mode === 'singles') return advancePositionWithLog(position, clicks.p1, clicks.p2, seed).log;
  return drawKeyed(position, clicks.p1, clicks.p2, seed, false).log;
}

const stampless = (log: readonly string[]): string[] => log.filter(line => !line.startsWith('|t:|'));
const asBattle = (log: string[]): Battle => ({ log }) as unknown as Battle;

/** (b4) The dice the quantiles answered for the first target, against what the battle shows of them. */
function pool(tally: Tally, { log, spy }: Fork, entries: SecondaryEntry[]): void {
  const first = (kind: DieName['kind']) => spy.answered.find(({ name, draw }) => name.kind === kind && name.effectId === undefined && name.targetSlot === 'p2a'
    && draw.call === 'chance' && (draw.numerator ?? 0) < (draw.from ?? 0));
  const accuracy = first('accuracy');
  if (accuracy) tally.add('accuracy', chanceOfDraw(accuracy.draw)!, missesOf(asBattle(log), 0, 'p2a') === 0);
  const crit = spy.answered.find(({ name, draw }) => name.kind === 'crit' && name.effectId === undefined && name.targetSlot === 'p2a' && draw.call === 'chance');
  if (crit && !log.some(line => line.startsWith('|-miss|'))) tally.add('crit', chanceOfDraw(crit.draw)!, critsOf(asBattle(log), 0, 'p2a') > 0);
  for (const entry of entries) {
    const asked = spy.answered.find(({ name }) => name.kind === 'secondary' && name.effectId === secondaryEffectId(entry) && name.targetSlot === 'p2a');
    const p = asked ? chanceOfDraw(asked.draw) : null;
    if (p !== null && p < 1) tally.add('secondary', p, effectShown(asBattle(log), 0, entry, 'p2a', 'p1a'));
  }
}

/** The pooled facts one move's forks give the case's tally, and the problems of (b1) and (b2). */
function playMove(mode: Mode, live: Battle, move: DexMove, clicks: { p1: string; p2: string }, tally: Tally, sheerForce = false): string[] {
  const problems: string[] = [];
  const before = standing(live);
  const position = rootOf(live);
  const entries = entriesOf(move).filter(witnessed);
  const perHit = !!move.multihit || !!move.multiaccuracy;
  let secondaryAsked = 0;
  for (let index = 0; index < ROOTS; index++) {
    const root = rootSalt(`${move.id} ${index}`);
    for (let offset = 0; offset < TREES; offset++) {
      let drawn: Fork;
      try {
        drawn = fork(mode, position, clicks, root, offset);
      } catch (error) {
        problems.push(`${move.id} root ${index} tree ${offset}: ${(error as Error).message}`);
        continue;
      }
      const { log, spy } = drawn;
      if (log.some(line => line.startsWith('|error|'))) problems.push(`${move.id} root ${index} tree ${offset}: an |error| line`);
      secondaryAsked += spy.answered.filter(({ name }) => name.kind === 'secondary').length;
      // (b1) no die answered: the plain draw of the seed
      if (spy.answered.length === 0 && offset === 0 && stampless(log).join('\n') !== stampless(plainLog(mode, position, clicks, root)).join('\n')) {
        problems.push(`${move.id} root ${index}: no die answered, and the log is not the plain draw`);
      }
      if (!perHit) pool(tally, drawn, entries);
    }
  }
  if (sheerForce && chanceEntry(move) && secondaryAsked > 0) problems.push(`${move.id}: Sheer Force left ${secondaryAsked} secondary dice for the quantiles`);
  // (b3) the live board
  if (standing(live) !== before) problems.push(`${move.id}: the live board changed`);
  return problems;
}

describe.each(SWEEP_CASES)('the root quantiles over the Dex: $name', ({ rules, mode, name }) => {
  const dex = dexOfRules(rules);
  const outfits: { label: string; ability?: string }[] = [{ label: 'no outfit' }];
  for (const [label, id, gen] of [['Serene Grace', 'serenegrace', 4], ['Sheer Force', 'sheerforce', 5]] as const) {
    if (rules.generation >= gen && dex.abilities.get(id).exists) outfits.push({ label, ability: dex.abilities.get(id).name });
  }
  const tolerance = toleranceOf(rules) > 1e-3 ? 0.02 : 0.0;

  for (const outfit of outfits) {
    test(`${name}, ${outfit.label}: every move with a die draws under the quantiles without a change to the board or the plain draw`, () => {
      const { moves } = sweepMoves(rules, move => (outfit.ability ? chanceEntry(move) : drawsDie(move)));
      const tally = new Tally();
      const problems: string[] = [];
      let played = 0;
      for (const move of moves) {
        const board = outfit.ability
          ? outfitBoard(rules, mode, { species: FAST, moves: [move.id], ability: outfit.ability }, { species: 'Vaporeon' })
          : sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
        const { live, clicks } = liveOf(board, move, sweepClicks(mode, move.target), sweepClicks(mode, move.target, true));
        if (!clicksAccepted(live, clicks)) continue;
        played++;
        problems.push(...playMove(mode, live, move, clicks, tally, outfit.label === 'Sheer Force'));
      }
      expect(problems.join(' | ')).toBe('');
      // a case with moves to play plays at least one
      expect(played).toBeGreaterThan(0);
      if (process.env.DICE_SWEEP_LOG) {
        appendFileSync(process.env.DICE_SWEEP_LOG, `${name}, ${outfit.label}: ${played} of ${moves.length} moves played; ${[...tally.pools].map(([key, pool]) => `${key}: ${pool.came}/${pool.n} (${pool.chances.toFixed(1)})`).join('; ')}\n`);
      }
      expect(tally.problems(tolerance).join(' | ')).toBe('');
    }, 600_000);
  }

  // a move with a flinch of 30 percent, read from the Dex of the rule set
  const flinch = (move: DexMove) => entriesOf(move).some(entry => entry.volatileStatus === 'flinch' && entry.chance === 30) && move.accuracy === 100 && !move.multihit && move.priority === 0;

  test(`${name}: a flinch of 30 percent comes true in one or two of the four trees`, () => {
    const { moves } = sweepMoves(rules, flinch);
    // the first move the board lets hit (Snore fails while its user is awake)
    const found = moves.map(candidate => {
      const board = sweepBoard(rules, candidate.id, mode, '1,2,3,4', false, FAST);
      const clicks = sweepClicks(mode, candidate.target);
      if (!clicksAccepted(board, clicks)) return null;
      const position = rootOf(board);
      return fork(mode, position, clicks, 1, 0).log.some(line => line.startsWith('|-damage|p2a')) ? { move: candidate, board, clicks, position } : null;
    }).find(Boolean);
    if (!found) return;
    expect(flinchBreaks(mode, found.move, found.clicks, found.position, SWEEPS_FULL ? 200 : 40).broken).toEqual([]);
  }, 600_000);
});

/**
 * The roots whose four trees break the strand: the flinch shows in none of them (unless a tree missed: Gens 1 and 2 miss a move of
 * 100 percent one time in 256) or in more than two. Also returns the counts that were seen.
 */
function flinchBreaks(mode: Mode, move: DexMove, clicks: { p1: string; p2: string }, position: ReturnType<typeof rootOf>, roots: number): { broken: string[]; counts: Set<number> } {
  const entry = entriesOf(move).find(candidate => candidate.volatileStatus === 'flinch')!;
  const broken: string[] = [];
  const counts = new Set<number>();
  for (let index = 0; index < roots; index++) {
    const root = rootSalt(`scene ${index}`);
    const logs = [0, 1, 2, 3].map(offset => fork(mode, position, clicks, root, offset).log);
    const missed = logs.some(log => missesOf(asBattle(log), 0, 'p2a') > 0);
    const came = logs.filter(log => effectShown(asBattle(log), 0, entry, 'p2a', 'p1a')).length;
    counts.add(came);
    if (came > 2 || (came < 1 && !missed)) broken.push(`root ${index}: ${came} of 4 trees`);
  }
  return { broken, counts };
}

// the reported scene: Doubles OU gen9doublesou-2694111300 t13, Iron Head's flinch of 30 percent, drawn by one or two of the four trees
describe.each(['singles', 'doubles'] as const)('Iron Head into a slower foe, %s (Scarlet/Violet)', mode => {
  test('the flinch comes true in one or two of the four trees, whatever the root', () => {
    const rules = SWEEP_CASES.find(candidate => candidate.rules.name === 'Gen 9' && candidate.mode === mode)!.rules;
    const board = sweepBoard(rules, 'ironhead', mode, '1,2,3,4', false, FAST);
    const clicks = sweepClicks(mode, 'normal');
    const { broken, counts } = flinchBreaks(mode, dexOfRules(rules).moves.get('ironhead'), clicks, rootOf(board), SWEEPS_FULL ? 400 : 100);
    expect(broken).toEqual([]);
    // both numbers occur: the trees do not all draw the same count
    expect(counts).toEqual(new Set([1, 2]));
  }, 600_000);
});

test('the sweep reads the rule sets it claims: ten of them, doubles from Gen 3 (eighteen cases)', () => {
  expect(SWEEP_CASES.length).toBe(18);
});
