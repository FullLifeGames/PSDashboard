import type { Battle } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';
import { sampleDecides } from './aim.ts';
import { naturalTurn, playForcedTurn } from './play.ts';
import { genShape, rollsAtTurnStart } from './recognize.ts';
import { readsStartRoll } from './start-roll.ts';
import { probeCheck } from './status-probe.ts';
import { dieKey, plainKey, tieName, type DieName, type Draw, type ForcedDie } from './types.ts';

/** The likeliest result of each die, and a turn played with every die at it, so the click that plays an engine line forces the dice the line assumes. */

export interface LikeliestDie { die: ForcedDie; /** The chance of the result the die takes, 0 to 1; absent when the draw names none. */ chance?: number }

/** Kinds that are one chance, forced to happen or not to; a status check has its own polarity. */
const CHANCE_KINDS = new Set(['accuracy', 'crit', 'secondary', 'self-effect', 'stalling', 'power', 'move-first', 'ability-proc', 'item-proc', 'end-of-turn']);

/** The mode of a list (first appearance order); a tie takes the lower middle one. */
function modeOf<T>(items: readonly T[]): { value: T; share: number } {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const modes = [...counts].filter(([, count]) => count === top).map(([value]) => value);
  return { value: modes[Math.floor((modes.length - 1) / 2)], share: top / items.length };
}

const chanceOfDraw = (draw: Draw): number | undefined => (draw.call === 'chance' ? (draw.numerator ?? 0) / (draw.from ?? 1) : draw.chance);

function chanceLikeliest(name: DieName, draw: Draw): LikeliestDie {
  const chance = chanceOfDraw(draw);
  if (chance === undefined) return { die: { name, result: { happens: false } } };
  return chance >= 0.5 ? { die: { name, result: { happens: true } }, chance } : { die: { name, result: { happens: false } }, chance: 1 - chance };
}

/** A status check: the body acts when that is one half or more likely; the polarity comes from the condition's own handler. */
function checkLikeliest(name: DieName, draw: Draw, battle: Battle): LikeliestDie | null {
  const chance = chanceOfDraw(draw);
  if (chance === undefined) return null;
  const probe = name.effectId ? probeCheck(battle, name.slot, name.effectId, name.moveId) : null;
  const goesOn = probe?.actsOnTrue ? chance : 1 - chance;
  return goesOn >= 0.5 ? { die: { name, result: { happens: true } }, chance: goesOn } : { die: { name, result: { happens: false } }, chance: 1 - goesOn };
}

/** A hit count: the draw's mode, or the middle of its range; a draw with no range (Loaded Dice, Population Bomb) names none. */
function hitsLikeliest(name: DieName, draw: Draw): LikeliestDie | null {
  if (draw.call === 'sample' && draw.items && draw.items.length > 0) {
    const { value, share } = modeOf(draw.items);
    return typeof value === 'number' ? { die: { name, result: { hits: value } }, chance: share } : null;
  }
  if (draw.call === 'random' && draw.to !== undefined) {
    const from = draw.from ?? 0;
    const count = draw.to - from;
    return count > 0 ? { die: { name, result: { hits: from + Math.floor((count - 1) / 2) } }, chance: 1 / count } : null;
  }
  return null;
}

/**
 * The likeliest result of one die at its draw, with the chance of that result, or null when the draw names no result to force.
 * A chance die happens at one half or more; the damage roll takes its middle step; a count or pick takes the mode of the draw's items;
 * a draw with no chance (the Gen 2 crit compares `random(256)` with a threshold the draw does not show) answers "does not happen".
 */
export function likeliestOf(name: DieName, draw: Draw, battle: Battle, gen: number): LikeliestDie | null {
  if (name.kind === 'status-check') return checkLikeliest(name, draw, battle);
  if (name.kind === 'damage-roll') return { die: { name, result: { step: Math.floor(genShape(gen).roll.steps / 2) } } };
  if (name.kind === 'hit-count') return hitsLikeliest(name, draw);
  if (name.kind === 'ability-proc' && draw.call === 'sample' && draw.items && draw.items.length > 0) {
    const { value, share } = modeOf(draw.items);
    return { die: { name, result: { option: String(value) } }, chance: share };
  }
  return CHANCE_KINDS.has(name.kind) ? chanceLikeliest(name, draw) : null;
}

const covered = (forced: ReadonlyMap<string, LikeliestDie>, name: DieName): boolean => forced.has(dieKey(name)) || forced.has(plainKey(name));

/** Forced dice for speed ties (the slot that sorts first wins) and for the start-of-turn die of Gens 2 and 3 (does not come true). */
function orderDice(live: Battle, play: (battle: Battle) => void): LikeliestDie[] {
  const natural = naturalTurn(live, play);
  const dice: LikeliestDie[] = [];
  const seen = new Set<string>();
  for (const slots of natural.ties) {
    const sorted = [...slots].sort();
    for (let index = 0; index < sorted.length; index++) {
      for (const other of sorted.slice(index + 1)) {
        const name = tieName(sorted[index], other);
        if (seen.has(dieKey(name))) continue;
        seen.add(dieKey(name));
        dice.push({ die: { name, result: { first: name.slot } } });
      }
    }
  }
  if (rollsAtTurnStart(live.gen)) {
    for (const slot of natural.acted.filter(acted => readsStartRoll(live, acted))) {
      const body = live.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
      dice.push({ die: { name: { slot, moveId: '', kind: 'move-first', effectId: body.item }, result: { happens: false } } });
    }
  }
  return dice;
}

/** Rounds a turn is replayed to close its dice: a forced hit after a natural miss draws a crit and a roll the natural turn did not. */
const MAX_ROUNDS = 6;

export interface LikeliestTurn {
  /** A copy of the battle after the turn; the input battle is never written. */
  battle: Battle;
  /** The dice the turn drew, each at its likeliest result. */
  dice: LikeliestDie[];
  /** The kinds of dice the draw could not name: the seed decides them. */
  unforced: string[];
  /** Draws of the played turn that no die names and no forced tie covers: the seed decides them. */
  unnamed: number;
}

/** A turn played with some dice pinned: `draws` holds the draw each die was read from, `drawOrder` the order the turn asked for them (die keys). */
export interface PinnedTurn extends LikeliestTurn {
  draws: ReadonlyMap<string, Draw>;
  drawOrder: readonly string[];
}

/** Plays `play` on a copy of `live` with every die at its likeliest result; `play` writes both sides' choices and runs several times, on copies. */
export function playLikeliestTurn(live: Battle, play: (battle: Battle) => void): LikeliestTurn {
  const { battle, dice, unforced, unnamed } = playTurnWith(live, play, []);
  return { battle, dice, unforced, unnamed };
}

/**
 * The likeliest turn with the dice in `pinned` held at the result the caller names, wherever the turn draws them; every other die takes
 * its likeliest result, so a die a pin makes appear (a forced hit adds a crit and a roll) is read from its own draw. `dice` lists the
 * dice the played turn drew, pinned ones included; `draws` is the input of `otherResults`.
 */
export function playTurnWith(live: Battle, play: (battle: Battle) => void, pinned: readonly LikeliestDie[]): PinnedTurn {
  const forced = new Map<string, LikeliestDie>();
  const skipped = new Map<string, DieName>();
  const draws = new Map<string, Draw>();
  for (const die of orderDice(live, play)) forced.set(dieKey(die.die.name), die);
  for (const die of pinned) forced.set(dieKey(die.die.name), die);
  for (let round = 0; ; round++) {
    const trial = copyOf(live);
    trial.prng = live.prng.clone();
    const seen = new Map<string, { name: DieName; draw: Draw }>();
    const report = playForcedTurn({
      live: trial, forced: [...forced.values()].map(entry => entry.die), play,
      onDraw: (name, _value, draw) => { if (!seen.has(dieKey(name))) seen.set(dieKey(name), { name, draw: { ...draw } }); },
    });
    let added = 0;
    for (const [key, { name, draw }] of seen) {
      draws.set(key, draw);
      if (covered(forced, name) || skipped.has(dieKey(name))) continue;
      const likeliest = likeliestOf(name, draw, live, live.gen);
      if (likeliest) {
        forced.set(dieKey(name), likeliest);
        added++;
      } else {
        skipped.set(dieKey(name), name);
      }
    }
    if (added === 0 || round >= MAX_ROUNDS) {
      const drawn = new Set(report.forced.filter(entry => entry.took !== 'no-draw').map(entry => dieKey(entry.die.name)));
      return {
        battle: trial,
        dice: [...forced.values()].filter(entry => drawn.has(dieKey(entry.die.name))),
        drawOrder: [...seen.keys()],
        // a random target whose sample cannot change the turn is no die the seed decides
        unforced: [...new Set([...skipped].filter(([key, name]) => name.kind !== 'random-target' || sampleDecides(trial.dex.moves.get(name.moveId).target, draws.get(key))).map(([, name]) => name.kind))],
        unnamed: report.unnamed ?? 0,
        draws,
      };
    }
  }
}

/** The outcome of a turn as a key: the bodies that fell, by side and name, and whether the game ended. */
export function fallen(battle: Battle): string {
  const names = battle.sides.slice(0, 2).flatMap(side => side.pokemon.filter(mon => mon.fainted).map(mon => `${side.id}:${mon.name}`));
  return `${names.sort().join(',')}${battle.ended ? '|ended' : ''}`;
}

/**
 * The share of rolls that give the chosen result of a damage roll, or null when the roll decides no knock-out (the same bodies fall at
 * the lowest and the highest roll).
 */
export function rollDecides(
  live: Battle, play: (battle: Battle) => void, dice: readonly ForcedDie[], index: number,
): { rolls: number; of: number; chance: number } | null {
  const die = dice[index];
  if (!die || die.name.kind !== 'damage-roll' || !('step' in die.result)) return null;
  const boundary = rollBoundary(live, play, dice, index);
  if (!boundary) return null;
  const { lo, steps } = boundary;
  const rolls = steps - lo;
  return { rolls, of: steps, chance: (die.result.step >= lo ? rolls : steps - rolls) / steps };
}

/**
 * The lowest step that gives the highest roll's outcome (the bodies that fall) and the number of steps; null when the lowest and the
 * highest roll give the same outcome. `plays` counts the turns played on copies.
 */
export function rollBoundary(
  live: Battle, play: (battle: Battle) => void, dice: readonly ForcedDie[], index: number,
): { lo: number; steps: number; plays: number } | null {
  const die = dice[index];
  if (!die || die.name.kind !== 'damage-roll' || !('step' in die.result)) return null;
  const steps = genShape(live.gen).roll.steps;
  let plays = 0;
  const outcomeAt = (step: number): string => {
    plays++;
    const trial = copyOf(live);
    trial.prng = live.prng.clone();
    playForcedTurn({ live: trial, forced: dice.map((entry, at) => (at === index ? { ...entry, result: { step } } : entry)), play });
    return fallen(trial);
  };
  const low = outcomeAt(0);
  const high = outcomeAt(steps - 1);
  if (low === high) return null;
  let lo = 0;
  let hi = steps - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (outcomeAt(mid) === high) hi = mid;
    else lo = mid + 1;
  }
  return { lo, steps, plays };
}

/**
 * The other results of one die and the simulator's own chance of each, from the draw `playTurnWith` keeps in `draws`: the one other
 * answer of a chance die, status check or speed tie; every other item of a count or pick. Never a damage roll (`rollBoundary`), a die
 * whose draw names no chance, or a result that is sure.
 */
export function otherResults(entry: LikeliestDie, draw: Draw | undefined): LikeliestDie[] {
  const { name, result } = entry.die;
  if (name.kind === 'speed-tie') {
    if (!('first' in result) || !name.targetSlot) return [];
    return [{ die: { name, result: { first: result.first === name.slot ? name.targetSlot : name.slot } }, chance: 0.5 }];
  }
  if ('happens' in result) {
    if (entry.chance === undefined || !(entry.chance > 0 && entry.chance < 1)) return [];
    return [{ die: { name, result: { happens: !result.happens } }, chance: 1 - entry.chance }];
  }
  if (!draw || !('hits' in result || 'option' in result)) return [];
  return otherItems(entry, draw);
}

function otherItems(entry: LikeliestDie, draw: Draw): LikeliestDie[] {
  const { name, result } = entry.die;
  const key = 'hits' in result ? result.hits : 'option' in result ? result.option : undefined;
  const asResult = (value: number | string): ForcedDie['result'] => ('hits' in result ? { hits: value as number } : { option: String(value) });
  if (draw.call === 'sample' && draw.items && draw.items.length > 0) {
    const counts = new Map<number | string, number>();
    for (const item of draw.items) counts.set(item as number | string, (counts.get(item as number | string) ?? 0) + 1);
    return [...counts].filter(([value]) => String(value) !== String(key)).map(([value, count]) => ({ die: { name, result: asResult(value) }, chance: count / draw.items!.length }));
  }
  if ('hits' in result && draw.call === 'random' && draw.to !== undefined) {
    const from = draw.from ?? 0;
    const values = Array.from({ length: draw.to - from }, (_, at) => from + at).filter(value => value !== key);
    return values.map(value => ({ die: { name, result: asResult(value) }, chance: 1 / (draw.to! - from) }));
  }
  return [];
}

/** The damage roll's other group across its knock-out boundary: its middle step and the share of rolls in it. */
export function otherRollGroup(entry: LikeliestDie, boundary: { lo: number; steps: number }): LikeliestDie | null {
  const { result } = entry.die;
  if (entry.die.name.kind !== 'damage-roll' || !('step' in result)) return null;
  const { lo, steps } = boundary;
  const [from, to] = result.step >= lo ? [0, lo - 1] : [lo, steps - 1];
  return { die: { name: entry.die.name, result: { step: from + Math.floor((to - from) / 2) } }, chance: (to - from + 1) / steps };
}

/**
 * Whether the user sees a chip for the die: only a die that could have gone the other way and did not read as the default. An event
 * that happens, a status check, a speed tie, a pick, a hit count and a stalling move that fails or works again show; the miss of a likely
 * hit, a crit that does not come, an effect that does not land and a roll that decides no knock-out do not.
 */
export function chipShown(die: ForcedDie, chance: number | undefined, decides: boolean): boolean {
  const { kind } = die.name;
  if (kind === 'speed-tie' || kind === 'hit-count') return true;
  if (kind === 'damage-roll') return decides;
  if (kind === 'status-check' || kind === 'accuracy') return chance !== undefined && chance < 1;
  // a stalling move's failure decided the turn and could have gone the other way: it shows as well as its success
  if (kind === 'stalling' && 'happens' in die.result && chance !== undefined) return chance < 1;
  if ('happens' in die.result) return die.result.happens && (chance === undefined || chance < 1);
  return 'option' in die.result;
}
