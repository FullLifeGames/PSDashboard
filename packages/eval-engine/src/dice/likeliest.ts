import type { Battle } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';
import { naturalTurn, playForcedTurn } from './play.ts';
import { genShape, rollsAtTurnStart } from './recognize.ts';
import { readsStartRoll } from './start-roll.ts';
import { probeCheck } from './status-probe.ts';
import { dieKey, plainKey, tieName, type DieName, type Draw, type ForcedDie } from './types.ts';

/**
 * Round 89 (#104, ruling 13): the likeliest result of each die, and a turn played with every die at it. A line of the engine names
 * the dice it assumes, so the click that plays the line forces exactly those dice and the variation reads the same under any seed.
 *
 * The rule reads the simulator's own draw (its chance, its range, its items), never a move or a species (AGENTS.md):
 * - a chance die (accuracy, crit, secondary, self effect, procs, end of turn, a stalling move again, a power die, a first mover)
 *   happens when its chance is one half or more;
 * - a status check lets the body act when that is one half or more likely (the polarity comes from the condition's own handler,
 *   `probeCheck`);
 * - the damage roll takes its middle step (step 8 of 16, step 19 of 39 in Gens 1 and 2);
 * - a hit count or a pick takes the likeliest of the draw's items (a count drawn twice as often as the others wins), and between
 *   results that tie the middle one in the simulator's order (the lower one of two);
 * - a speed tie goes to the slot that sorts first;
 * - the die of Gens 2 and 3 that lets a holder act first at the start of the turn does not come true.
 * A die whose draw names no chance (the Gen 2 crit compares `random(256)` with a threshold the draw does not show) answers "does not
 * happen": every such die is a crit or a proc that is rarer than one half. A die the draw cannot name at all is left to the stream
 * and listed (`unforced`). Draws no die names (a duration, a random target) follow the stream too: `unnamed` counts them.
 *
 * The turn is played the way `playForcedTurn` plays one: the dice the turn draws are read on a copy, forced at their likeliest
 * result, and the turn is played again until it draws nothing that is not forced (a forced hit adds a crit and a roll the natural
 * miss did not draw). The last pass is the played turn.
 */

export interface LikeliestDie { die: ForcedDie; /** The chance of the result the die takes, 0 to 1; absent when the draw names none. */ chance?: number }

/** The kinds that are one chance: forced to happen or not to. A status check has its own polarity. */
const CHANCE_KINDS = new Set(['accuracy', 'crit', 'secondary', 'self-effect', 'stalling', 'power', 'move-first', 'ability-proc', 'item-proc', 'end-of-turn']);

/** The likeliest of a list of results by their number of occurrences (first appearance order); a tie takes the lower middle one. */
function modeOf<T>(items: readonly T[]): { value: T; share: number } {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const modes = [...counts].filter(([, count]) => count === top).map(([value]) => value);
  return { value: modes[Math.floor((modes.length - 1) / 2)], share: top / items.length };
}

/** The chance a chance draw carries: a `randomChance`'s numerator over its denominator, or the one the recognition read from the simulator's state. */
const chanceOfDraw = (draw: Draw): number | undefined => (draw.call === 'chance' ? (draw.numerator ?? 0) / (draw.from ?? 1) : draw.chance);

/** A chance die's likeliest result: it happens at one half or more; a draw that names no chance answers "does not happen". */
function chanceLikeliest(name: DieName, draw: Draw): LikeliestDie {
  const chance = chanceOfDraw(draw);
  if (chance === undefined) return { die: { name, result: { happens: false } } };
  return chance >= 0.5 ? { die: { name, result: { happens: true } }, chance } : { die: { name, result: { happens: false } }, chance: 1 - chance };
}

/** A status check: the body goes on when that is one half or more likely; the polarity of the draw comes from the condition's handler. */
function checkLikeliest(name: DieName, draw: Draw, battle: Battle): LikeliestDie | null {
  const chance = chanceOfDraw(draw);
  if (chance === undefined) return null;
  const probe = name.effectId ? probeCheck(battle, name.slot, name.effectId, name.moveId) : null;
  const goesOn = probe?.actsOnTrue ? chance : 1 - chance;
  return goesOn >= 0.5 ? { die: { name, result: { happens: true } }, chance: goesOn } : { die: { name, result: { happens: false } }, chance: 1 - goesOn };
}

/** A hit count: the likeliest item of a sample, or the middle of a range; a draw with no range (Loaded Dice, Population Bomb) names none. */
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
 * The likeliest result of one die at its draw, with the chance of that result, or null when the draw names no result the module can
 * force (a hit count whose draw has no range: Loaded Dice, Population Bomb).
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

/** Whether a die is covered by the dice already forced: its own key, or the plain key of the move's every hit. */
const covered = (forced: ReadonlyMap<string, LikeliestDie>, name: DieName): boolean => forced.has(dieKey(name)) || forced.has(plainKey(name));

/** The pairs of bodies that tied in speed and the holders of the start-of-turn die, as forced dice (the module reads neither from a draw of a run). */
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

/** The rounds a turn is replayed to close its dice: a forced hit after a natural miss adds dice, a forced crit adds none. */
const MAX_ROUNDS = 6;

export interface LikeliestTurn {
  /** A copy of the battle after the turn, played with the dice below; the input battle is read and never written. */
  battle: Battle;
  /** The dice the turn drew, each at its likeliest result (a die the played turn never drew is left out). */
  dice: LikeliestDie[];
  /** The kinds of the dice the draw could not name: left to the stream, so the turn depends on the seed there. */
  unforced: string[];
  /** The draws of the played turn that no die names and no forced tie covers: the seed decides them. */
  unnamed: number;
}

/**
 * Plays `play` on a copy of `live` with every die at its likeliest result. `play` writes both sides' choices to the battle it gets
 * and lets the turn run (it runs several times, on copies). The copy carries the stream of the live battle's PRNG; nothing the
 * dice name reads it.
 */
export function playLikeliestTurn(live: Battle, play: (battle: Battle) => void): LikeliestTurn {
  const forced = new Map<string, LikeliestDie>();
  const skipped = new Map<string, DieName>();
  for (const die of orderDice(live, play)) forced.set(dieKey(die.die.name), die);
  for (let round = 0; ; round++) {
    const trial = copyOf(live);
    trial.prng = live.prng.clone();
    const seen = new Map<string, { name: DieName; draw: Draw }>();
    const report = playForcedTurn({
      live: trial, forced: [...forced.values()].map(entry => entry.die), play,
      onDraw: (name, _value, draw) => { if (!seen.has(dieKey(name))) seen.set(dieKey(name), { name, draw: { ...draw } }); },
    });
    let added = 0;
    for (const { name, draw } of seen.values()) {
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
        unforced: [...new Set([...skipped.values()].map(name => name.kind))],
        unnamed: report.unnamed ?? 0,
      };
    }
  }
}

/** Who stands after a turn: the bodies that fell, by side and name, and whether the game ended. */
export function fallen(battle: Battle): string {
  const names = battle.sides.slice(0, 2).flatMap(side => side.pokemon.filter(mon => mon.fainted).map(mon => `${side.id}:${mon.name}`));
  return `${names.sort().join(',')}${battle.ended ? '|ended' : ''}`;
}

/**
 * Round 89 (#104, D6): the chip of a damage roll names the knock-out only when the roll decides it. The step is played on copies with
 * the die at its lowest and at its highest roll; when the same bodies fall both times the roll does not decide; else a bisection finds
 * the lowest roll that gives the highest roll's result, and the chance of the chosen result is the share of rolls that give it. At
 * most two plays and one bisection (log2 of the steps) per die.
 */
export function rollDecides(
  live: Battle, play: (battle: Battle) => void, dice: readonly ForcedDie[], index: number,
): { rolls: number; of: number; chance: number } | null {
  const die = dice[index];
  if (!die || die.name.kind !== 'damage-roll' || !('step' in die.result)) return null;
  const steps = genShape(live.gen).roll.steps;
  const outcomeAt = (step: number): string => {
    const trial = copyOf(live);
    trial.prng = live.prng.clone();
    playForcedTurn({ live: trial, forced: dice.map((entry, at) => (at === index ? { ...entry, result: { step } } : entry)), play });
    return fallen(trial);
  };
  const low = outcomeAt(0);
  const high = outcomeAt(steps - 1);
  if (low === high) return null;
  // the lowest roll whose outcome is the highest roll's
  let lo = 0;
  let hi = steps - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (outcomeAt(mid) === high) hi = mid;
    else lo = mid + 1;
  }
  const rolls = steps - lo;
  return { rolls, of: steps, chance: (die.result.step >= lo ? rolls : steps - rolls) / steps };
}

/**
 * Round 89 (#104, ruling 33 question 3a): whether the user sees a chip for the die: only a die that could have gone the other way and
 * did not read as the default. An event that happens (a hit below 100 percent, a crit, an effect that lands, a pick, a hit count), a
 * status check and a speed tie show; the miss of a likely hit, a crit that does not come, an effect that does not land and a roll
 * that decides no knock-out do not (the tooltip of the button lists every die).
 */
export function chipShown(die: ForcedDie, chance: number | undefined, decides: boolean): boolean {
  const { kind } = die.name;
  if (kind === 'speed-tie' || kind === 'hit-count') return true;
  if (kind === 'damage-roll') return decides;
  if (kind === 'status-check' || kind === 'accuracy') return chance !== undefined && chance < 1;
  if ('happens' in die.result) return die.result.happens && (chance === undefined || chance < 1);
  return 'option' in die.result;
}
