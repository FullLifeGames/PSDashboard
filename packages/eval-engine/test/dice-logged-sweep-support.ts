import type { Battle, PokemonSet } from '@pkmn/sim';
import { extractProtocolEvents, isPerfectAlignment, scoreAlignment, type ProtocolEvents } from '../src/hax-alignment';
import { strengthMix } from '../src/calc/fickle';
import { loggedActions, loggedDice, type LoggedOptions } from '../src/dice/logged-results';
import { playForcedTurn } from '../src/dice/play';
import { loggedOptions } from '../src/dice/turn';
import type { ForcedDie } from '../src/dice/types';
import { playClicks, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { sweepBoard, sweepClicks, clicksAccepted, isCharge, isDelayed, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/**
 * Round 86 (the engine reads the dice), lane B, step B2: the trial the logged-dice sweep plays for every Dex entry of a kind.
 * A turn plays on a board under one seed and writes a log; the dice the reader names from that log, forced on the same board
 * under another seed, must give a turn with the log's events (`scoreAlignment` perfect). A seed pair is a witness when the
 * other seed alone would differ from the log in the kind's channels, so the forcing has something to repair. The channels a
 * kind decides are named here; the rest of the turn is held to the log all the same.
 */

/** The channels of `ProtocolEvents` a kind of die decides. */
export type Channel = 'misses' | 'crits' | 'secondaries' | 'hitCounts' | 'cants' | 'confusionSelfHits' | 'moveOrder';

/** How many seed pairs a move scans for witnesses: a 1 in 24 crit needs a dozen pairs to show itself in most moves. */
const POOL = 12;
/**
 * The seeds of pair `index`: spread over the whole range of the generator (nearby seeds such as 1,2,3,4 and 5,6,7,8 start the
 * generator on nearly the same draws, so rare dice like a crit would never differ between two of them).
 */
const mixed = (n: number): string => [1, 2, 3, 4].map(k => ((n + 1) * 7919 + k * 104729 + ((n * k) % 13) * 4093) % 65521 + 1).join(',');
const logSeed = (index: number): string => mixed(index * 2);
const otherSeed = (index: number): string => mixed(index * 2 + 1);

const sameEntries = (a: Map<string, number> | string[], b: Map<string, number> | string[]): boolean =>
  JSON.stringify(a instanceof Map ? [...a].sort() : a) === JSON.stringify(b instanceof Map ? [...b].sort() : b);

/** Whether two turns differ in a channel. */
export function differsIn(a: ProtocolEvents, b: ProtocolEvents, channels: readonly Channel[]): boolean {
  return channels.some(channel => !sameEntries(a[channel], b[channel]));
}

/** A multi-hit move whose hits crit unevenly: one die names every hit's crit, so the log cannot be forced for it. */
const unevenCrits = (log: string[]): boolean =>
  loggedActions(log).some(action => Object.entries(action.crits).some(([slot, crits]) => crits < (action.damaged[slot] ?? 0)));

/** What one witness scan counted and which seed pairs the forced turn did not repair. */
export interface Scan { scanned: number; skipped: number; witnesses: number; named: number; rollFaints: number; failures: string[]; why: Record<string, number> }

/** A scene: the board under a seed (a charge move's first turn or a stalling move's first use already played), the two sides' clicks, what the caller names about the turn. */
export interface Scene {
  board(seed: string): Battle;
  clicks: { p1: string; p2: string };
  options: LoggedOptions;
  /** The channels the kind decides; a pair is a witness when the other seed differs from the log in one of them. */
  channels: readonly Channel[];
  /** How many seed pairs to scan for witnesses (a kind that needs a rare log, a broken chain, scans more). */
  pool?: number;
  /** How many witnesses to find (the sweep's own number when absent). */
  want?: number;
  /** A kind that no channel of the alignment shows (the `|-fail|` of a stalling move) decides the witness from the two logs itself. */
  differs?(log: string[], naturalLog: string[]): boolean;
  /** The kind of die the log must name in at least one witness. */
  kind?: ForcedDie['name']['kind'];
  /** The turn's own check of a forced turn on top of the perfect score (the stalling move's `|-fail|`). */
  extra?(log: string[], forcedLog: string[]): string | null;
}

function turn(battle: Battle, scene: Scene, forced?: readonly ForcedDie[]): string[] {
  const start = battle.log.length;
  if (forced) playForcedTurn({ live: battle, forced, play: played => playClicks(played, scene.clicks) });
  else playClicks(battle, scene.clicks);
  return battle.log.slice(start);
}

/** Why a log leaves the sweep: a faint or an end (the damage roll), no die to force, crits that differ between the hits of one move. */
function leftOut(scene: Scene, expected: ProtocolEvents, dice: readonly ForcedDie[], log: string[]): string | null {
  if (expected.faints.size > 0) return 'faint';
  if (expected.ended) return 'ended';
  if (dice.length === 0 && !scene.differs) return 'no die';
  return unevenCrits(log) ? 'uneven crits' : null;
}

/** Plays the scene on seed pairs until `want` witnesses are found (or the pool is scanned) and forces the log's dice on each. */
export function scan(scene: Scene, want: number): Scan {
  const result: Scan = { scanned: 0, skipped: 0, witnesses: 0, named: 0, rollFaints: 0, failures: [], why: {} };
  for (let index = 0; index < (scene.pool ?? POOL) && result.witnesses < (scene.want ?? want); index++) {
    const [source, other] = [scene.board(logSeed(index)), scene.board(otherSeed(index))];
    result.scanned++;
    const log = turn(source, scene);
    const expected = extractProtocolEvents(log);
    const dice = loggedDice(log, scene.options);
    // a faint changes the turn for a reason that is no die (the damage roll): the sweep leaves those logs out
    const left = leftOut(scene, expected, dice, log);
    if (left) { result.skipped++; result.why[left] = (result.why[left] ?? 0) + 1; continue; }
    const naturalLog = turn(scene.board(otherSeed(index)), scene);
    const moved = scene.differs ? scene.differs(log, naturalLog) : differsIn(expected, extractProtocolEvents(naturalLog), scene.channels);
    if (!moved) { result.skipped++; result.why.unmoved = (result.why.unmoved ?? 0) + 1; continue; }
    result.witnesses++;
    if (!scene.kind || dice.some(die => die.name.kind === scene.kind)) result.named++;
    const forcedLog = turn(other, scene, dice);
    const score = scoreAlignment(expected, extractProtocolEvents(forcedLog));
    const own = scene.extra?.(log, forcedLog);
    if (own) result.failures.push(`seed ${index}: ${own}`);
    // the log's turn has no faint: a faint in the forced turn is the other seed's damage roll killing a body the log's roll left alive (the faint step of B4, no die of the log)
    if (score.faintMismatches > 0) { result.rollFaints++; continue; }
    if (!isPerfectAlignment(score)) result.failures.push(`seed ${index}: ${JSON.stringify(score)}`);
  }
  return result;
}

/** The clicked move of every body of a board: the attacker's, the others splash. */
export function clickedOf(moveId: string, mode: Mode): Map<string, string> {
  const clicked = new Map([['p1a', moveId], ['p2a', 'splash']]);
  if (mode === 'doubles') for (const slot of ['p1b', 'p2b']) clicked.set(slot, 'splash');
  return clicked;
}

/** The scene of a Dex move on the sweep's board (Snorlax uses it against a Vaporeon), or null when the click is refused or the move lands later. */
export function moveScene(
  rules: Rules, mode: Mode, move: DexMove, extra: Pick<Scene, 'channels' | 'kind' | 'options'> & Partial<Pick<Scene, 'extra' | 'pool'>>,
  outfit?: { item?: string; ability?: string },
): Scene | null {
  if (isDelayed(move)) return null;
  const charge = isCharge(move);
  const board = (seed: string): Battle => outfit ? outfitted(rules, mode, move.id, seed, outfit) : sweepBoard(rules, move.id, mode, seed);
  const first = sweepClicks(mode, move.target);
  const clicks = charge ? sweepClicks(mode, move.target, true) : first;
  const probe = board('1,2,3,4');
  if (!clicksAccepted(probe, first)) return null;
  if (charge) {
    playClicks(probe, first);
    if (!clicksAccepted(probe, clicks)) return null;
  }
  return {
    board: seed => {
      const battle = board(seed);
      if (charge) playClicks(battle, first);
      return battle;
    },
    clicks, ...extra,
    // what the app reads from the offers and the Dex of the click (`loggedOptions`): the rest of the options the caller names
    options: { ...extra.options, selfOf: loggedOptions(probe, clicks).selfOf },
  };
}

/** Snorlax with an item or ability uses the move against a Vaporeon (the sweep's board with an outfit). */
function outfitted(rules: Rules, mode: Mode, moveId: string, seed: string, outfit: { item?: string; ability?: string }): Battle {
  const base = { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...(rules.generation >= 2 ? { gender: 'M' as const } : {}) };
  const attacker = set('Snorlax', [moveId], { ...base, item: outfit.item ?? '', ability: outfit.ability ?? 'No Ability' });
  const foe = (species: string, moves = ['splash']): PokemonSet => set(species, moves, { ...base, ...(rules.generation >= 2 ? { gender: 'F' as const } : {}) });
  if (mode === 'singles') return battleOf(rules.singles, [attacker], [foe('Vaporeon')], seed);
  return battleOf(rules.doubles!, [attacker, foe('Blissey')], [foe('Vaporeon'), foe('Vaporeon')], seed);
}

/** The seeds a sweep plays per move: two in a plain run, four with `DICE_SWEEPS=full`. */
export const witnessesWanted = (): number => sweepSelection([0, 1, 2, 3], 'seeds').length;

/** Every move of the Dex with a chance that changes its power (the census reads the whole list, as `dice-census.spec.ts` does). */
export function powerMoves(dex: Parameters<typeof strengthMix>[0]): { id: string; name: string }[] {
  return (dex as unknown as { moves: { all(): { exists: boolean; id: string; name: string }[] } }).moves.all()
    .filter(move => move.exists && strengthMix(dex, move.name) !== null).map(move => ({ id: move.id, name: move.name }));
}
