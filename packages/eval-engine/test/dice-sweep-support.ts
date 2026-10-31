import { Battle as SimBattle, PRNG, Teams, toID, type Battle, type Pokemon } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { playForcedTurn } from '../src/dice/play';
import { genShape } from '../src/dice/recognize';
import type { DiceReport, DieName, ForcedDie } from '../src/dice/types';
import { copyOf } from '../src/sim-ask/copy';
import { CHAMPIONS, mon, playClicks, RULES, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 82 (forced dice): the boards and the bookkeeping the three sweeps (accuracy, crit, damage roll) share. One case
 * is a rule set, a game type and a move: Snorlax uses the move against a Vaporeon (a pure Water type: no type immunity of
 * any generation reaches it), the other bodies splash. Every Dex read goes through `rulesDex`.
 */

export type DexMove = ReturnType<ReturnType<typeof rulesDex>['moves']['get']>;

export const dexOfRules = (rules: Rules) => (rules === CHAMPIONS ? rulesDex(0) : rulesDex(rules.generation));

/** The rule sets and game types the sweeps play: Gens 1 and 2 in singles, Gens 3 on and Champions in singles and doubles. */
export const SWEEP_CASES: { rules: Rules; mode: Mode; name: string }[] = RULES.flatMap(rules =>
  (rules.doubles ? ['singles', 'doubles'] as const : ['singles'] as const).map(mode => ({ rules, mode, name: `${rules.name} ${mode}` })));

/** Moves that reach a foe: the others (a side, the field, the user, an ally) draw no accuracy or crit against a foe. */
const FOE_REACHING = new Set(['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent', 'randomNormal', 'scripted']);
/** In doubles these moves need a target in the click. */
const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);

/** Every move a rule set plays (the probe's filter: no Z or Max moves, past moves stay) that the sweep's predicate keeps and a foe can be the target of. */
export function sweepMoves(rules: Rules, keep: (move: DexMove) => boolean): { moves: DexMove[]; skipped: number } {
  const dex = dexOfRules(rules);
  const all = dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
    && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past') && keep(move));
  const moves = all.filter(move => FOE_REACHING.has(move.target));
  return { moves, skipped: all.length - moves.length };
}

/** The rule sets VGC plays (Scarlet/Violet and Champions doubles): a team of six per side. */
export const VGC_RULES: Rules[] = RULES.filter(rules => rules.doubles && (rules.generation === 9));

/**
 * The board of a case: Snorlax with the move leads side p1, a Vaporeon leads side p2, in doubles a Blissey and a second Vaporeon
 * splash beside them. `vgc` gives each side a team of six (the four behind the leads splash), as a VGC team has. The custom game takes the whole team into the battle: it asks for no team preview here, so nobody is left at home.
 */
export function sweepBoard(rules: Rules, moveId: string, mode: Mode, seed = '1,2,3,4', vgc = false): Battle {
  const attacker = mon(rules, { species: 'Snorlax', moves: [moveId], gender: 'M' });
  const vaporeon = mon(rules, { species: 'Vaporeon', moves: ['splash'] });
  if (mode === 'singles') return battleOf(rules.singles, [attacker], [vaporeon], seed);
  const p1 = [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })];
  const p2 = [vaporeon, mon(rules, { species: 'Vaporeon', moves: ['splash'] })];
  if (!vgc) return battleOf(rules.doubles!, p1, p2, seed);
  const bench = ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'].map(species => mon(rules, { species, moves: ['splash'] }));
  const battle = new SimBattle({
    formatid: toID(rules.doubles!), seed,
    p1: { name: 'Alpha', team: Teams.pack([...p1, ...bench]) }, p2: { name: 'Beta', team: Teams.pack([...p2, ...bench]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 123456');
    battle.choose('p2', 'team 123456');
  }
  return battle;
}

/**
 * The two sides' clicks: the attacker uses its move (aimed at the first foe when it needs a target), the rest splash. A body
 * locked into the second turn of a charge move takes no target (the simulator refuses one).
 */
export function sweepClicks(mode: Mode, target: string, locked = false): { p1: string; p2: string } {
  if (mode === 'singles') return { p1: 'move 1', p2: 'move 1' };
  return { p1: `move 1${NEEDS_AIM.has(target) && !locked ? ' 1' : ''}, move 1`, p2: 'move 1, move 1' };
}

/** The slots a move can draw for, each forced on its own: the aimed foe, both foes of a spread move, the ally too when the move reaches everybody. */
export function sweepTargets(mode: Mode, target: string): string[] {
  if (mode === 'singles') return ['p2a'];
  if (target === 'allAdjacentFoes' || target === 'randomNormal' || target === 'scripted') return ['p2a', 'p2b'];
  if (target === 'allAdjacent') return ['p2a', 'p2b', 'p1b'];
  return ['p2a'];
}

/** A move that picks its target or its draws at random: one of the slots shows it, the others legitimately draw nothing. */
export const picksOne = (target: string): boolean => target === 'randomNormal' || target === 'scripted';

/** A move of two turns (a charge): the first turn plays plain, the forced die belongs to the second. */
export const isCharge = (move: DexMove): boolean => !!move.flags.charge;

/**
 * A future move lands two turns later in the end-of-turn residual, when no move is in flight. The module names no die for it in
 * the turn it starts (the kind of die for it is an end-of-turn die, step A4): the sweeps hold that the report says `no-draw`
 * with that reason and the protocol shows no miss.
 */
export const isDelayed = (move: DexMove): boolean => !!move.flags.futuremove;

/**
 * Whether the simulator takes the clicks on this board: a move with a condition that is not met (Belch before a berry is
 * eaten) is disabled and its click refused, so no turn and no die exist for it.
 */
export function clicksAccepted(board: Battle, clicks: { p1: string; p2: string }): boolean {
  const probe = copyOf(board);
  probe.prng ??= board.prng.clone();
  return probe.choose('p1', clicks.p1) && probe.choose('p2', clicks.p2);
}

/** One forced turn on a copy of the board; the board stays at its turn so the next answer starts from the same place. */
export function forcedOn(board: Battle, clicks: { p1: string; p2: string }, forced: ForcedDie[]): { report: DiceReport; battle: Battle; start: number } {
  const live = copyOf(board);
  // the speed layer's copy leaves the stream to its asker
  live.prng ??= board.prng.clone();
  const start = live.log.length;
  const report = playForcedTurn({ live, forced, play: battle => playClicks(battle, clicks) });
  return { report, battle: live, start };
}

export const dieOf = (moveId: string, targetSlot: string, kind: DieName['kind']): DieName => ({ slot: 'p1a', moveId, targetSlot, kind });

/** The protocol lines of the forced turn that start with `prefix`. */
export const turnLines = (battle: Battle, start: number, prefix: string): string[] => battle.log.slice(start).filter(line => line.startsWith(prefix));

const slotOfIdent = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

/** The `|-miss|` lines of the turn about a slot: Gens 3 and up name the target, Gens 1 and 2 only the user (so every miss counts there). */
export const missesOf = (battle: Battle, start: number, slot: string): number =>
  turnLines(battle, start, '|-miss|').filter(line => { const target = line.split('|')[3]; return target === undefined || slotOfIdent(target) === slot; }).length;

/** The `|-crit|` lines of the turn about a slot. */
export const critsOf = (battle: Battle, start: number, slot: string): number =>
  turnLines(battle, start, '|-crit|').filter(line => slotOfIdent(line.split('|')[2]) === slot).length;

/** A reason that names a protocol line or says what the user did instead; the generic sentence of a die the module should have named is the failure. */
export const explained = (reason: string | undefined): boolean => !!reason && /did not use|did not run|did nothing|lands two turns later|shows "|always crits|cannot miss/.test(reason);

/** What a sweep counted; written to the log named by `DICE_SWEEP_LOG` when set. */
export interface Tally { cases: number; applied: number; blocked: number; noChance: number; noDraw: number; bad: string[]; unexercised: string[] }
export const newTally = (): Tally => ({ cases: 0, applied: 0, blocked: 0, noChance: 0, noDraw: 0, bad: [], unexercised: [] });

/** The body in a slot (`p2a`, `p1b`). */
export function monOf(battle: Battle, slot: string): Pokemon {
  return battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
}

/**
 * The damage a body loses when the simulator itself draws `raw` for every damage roll of the turn: the oracle of the roll
 * sweeps and of the answer spec. The turn plays on a copy with a PRNG that answers the draws inside `battle.randomizer`
 * (Gens 3 and up; a crit chance of 1 in 16 draws `random(16)` too, so the script call decides) or the
 * `random(217, 256)` of Gens 1 and 2 with the raw value, and the stream for everything else.
 */
export function damageAtRaw(board: Battle, clicks: { p1: string; p2: string }, slot: string, raw: number): number {
  const shape = genShape(board.gen).roll;
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  const natural = battle.prng;
  let inRandomizer = false;
  const original = (battle as unknown as { randomizer(...args: unknown[]): unknown }).randomizer;
  (battle as unknown as { randomizer: unknown }).randomizer = function (this: unknown, ...args: unknown[]) {
    inRandomizer = true;
    try {
      return original.apply(this, args);
    } finally {
      inRandomizer = false;
    }
  };
  battle.prng = new (class extends PRNG {
    override random(from?: number, to?: number): number {
      const value = natural.random(from, to);
      const isRoll = shape.scope === 'randomizer' ? inRandomizer : from === shape.from && to === shape.to;
      return isRoll ? raw : value;
    }
  })(natural.getSeed());
  playClicks(battle, clicks);
  const target = monOf(battle, slot);
  return target.maxhp - target.hp;
}
