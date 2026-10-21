import type { Battle, ID, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from '../sim-ask/index.ts';
import { playResiduals, slotsOf } from './residuals.ts';
import { damageOf } from './status-factor.ts';
import { MAX_PRICED_HITS, NO_COST, type HitCost, type StatusCost } from './contact-cost.ts';

/**
 * Plays one hit of a move on copies of the board and reads what it costs the attacker (13.10.2026, the Swords
 * Dance report on gen9draft-2058494320: Cobalion's contact moves into Talonflame meet Flame Body). The simulator's own
 * move use runs: whether the move makes contact (Long Reach, Protective Pads), what the foe's item and ability do
 * about it (Rocky Helmet, Rough Skin, Iron Barbs, Flame Body, Static, Poison Point, Effect Spore), what the attacker's
 * item and the move do to the attacker (Life Orb, recoil, a move that KOs its user), and what Magic Guard, Rock Head
 * or a type immunity prevent. Nothing here knows a name.
 *
 * The dice are quantiles. Every draw of one played hit answers the same quantile u of its range (random(n) is
 * floor(u * n), a chance of n in d fires when u < n / d), and the hit is played on the grid u = (k + 1/2) / 20. A chance
 * event then fires in exactly the share of the grid below its chance, so the 30% of Flame Body reads as 30% and not as
 * what a handful of seeds happened to give, and the damage rolls and the number of hits of a multi-hit move average
 * over their whole range. Two probes (u = 0.075 and 0.925) come first: a chance event fires at the low one and not at the
 * high one, so when the hit leaves the same status (or none) in both and the move does not roll its hit count, the hit is
 * deterministic and the mean of the probes is its cost (the damage rolls at the two ends average to the middle one);
 * otherwise the other 18 points of the grid are played too.
 *
 * Each hit is played at full HP on both sides and with the foe's whole HP under it: the chip is the amount of the
 * effect, not what a body at low HP has left, and a recoil is read on a hit that does not run into the foe's last HP
 * (the race counts the hit that finishes it as free, score/contact-price.ts). A benched body is put on the field of
 * the copy for the hit, as the static asks the simulator about benched bodies everywhere else.
 */

/** The points of the grid, the two probes at its ends that decide whether the hit rolls anything, and the middle one. */
const GRID = 20;
const PROBES = [1, 18];
const MIDDLE = 9;
const quantileOf = (index: number): number => (index + 0.5) / GRID;

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** A board with the pair ready for a hit: both on the field of a copy, both at full HP. */
interface Setup { copy: Battle; attacker: Pokemon; defender: Pokemon }

/** The body of the copy that stands where `pokemon` stands in its battle. */
const counterpart = (battle: Battle, copy: Battle, pokemon: Pokemon): Pokemon =>
  copy.sides[battle.sides.indexOf(pokemon.side)].pokemon[pokemon.side.pokemon.indexOf(pokemon)];

/**
 * Puts a benched body in the place of its side's first live active, the way a switch does it in the simulator (the
 * team order, the positions, the active list), without the events of a switch-in: the body then answers every event
 * of the field as an active one, and the end of the turn reaches it.
 */
function bringIn(pokemon: Pokemon): void {
  if (pokemon.isActive) return;
  const { side } = pokemon;
  const slot = Math.max(0, side.active.findIndex(entry => !!entry && !entry.fainted));
  const out = side.active[slot];
  const into = side.pokemon.indexOf(pokemon);
  const outOf = out ? side.pokemon.indexOf(out) : -1;
  if (out && outOf >= 0) {
    side.pokemon[into] = out;
    side.pokemon[outOf] = pokemon;
    out.position = into;
    pokemon.position = outOf;
    out.isActive = false;
  }
  pokemon.isActive = true;
  side.active[slot] = pokemon;
}

/**
 * `neutral` strips the pair of everything that could change a hit: no item and no ability on either body, and a foe
 * of the typeless type, which every move hits for its plain damage. What a move costs its user on such a pair is
 * the move's own cost (recoil, a self-destruct, a charge it pays), whatever the Dex lists as its fields.
 */
function prepare(battle: Battle, attacker: Pokemon, defender: Pokemon, neutral = false): Setup {
  const copy = copyOf(battle);
  (copy as unknown as { debugMode: boolean }).debugMode = false;
  const setup = { copy, attacker: counterpart(battle, copy, attacker), defender: counterpart(battle, copy, defender) };
  bringIn(setup.attacker);
  bringIn(setup.defender);
  setup.attacker.hp = setup.attacker.maxhp;
  setup.defender.hp = setup.defender.maxhp;
  if (neutral) {
    for (const body of [setup.attacker, setup.defender]) {
      body.item = '' as ID;
      body.ability = 'noability' as ID;
    }
    setup.defender.setType('???');
  }
  return setup;
}

/** What one played hit left on the attacker. */
interface Run {
  /** The HP the hit took, as a share of the attacker's max HP. */
  lost: number;
  /** The status the hit left on the attacker, or the item it took over (the foe's Sticky Barb), or ''. */
  label: string;
  setup: Setup;
}

const SPREAD = new Set(['allAdjacentFoes', 'allAdjacent']);

/**
 * One move use of the attacker on the defender: it hits (accuracy sure, and the move's own precondition off: a Sucker
 * Punch that waits for the foe's attack, a Fake Out for the first turn, a Poltergeist for an item; the damage the races
 * price for these moves assumes the hit as well), and a spread move hits the one foe of the pair (a 1v1 race).
 */
function strike({ copy, attacker, defender }: Setup, moveId: string): void {
  const move = copy.dex.getActiveMove(moveId);
  move.accuracy = true;
  move.onTry = undefined;
  if (SPREAD.has(move.target)) move.target = 'normal';
  copy.actions.useMove(move, attacker, { target: defender });
}

/** The attacker uses the move on the defender (a charge move strikes on its second turn), on a fresh copy, with every draw answering `quantile`. */
function playRun(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, quantile: number, neutral = false): Run {
  const setup = prepare(battle, attacker, defender, neutral);
  const { copy } = setup;
  const mine = setup.attacker;
  copy.prng = new FixedDice({ quantile });
  const hp = mine.hp;
  const status = mine.status;
  const item = mine.item;
  let healed = 0;
  const heal = copy.heal.bind(copy);
  copy.heal = ((...args: Parameters<Battle['heal']>) => {
    const done = heal(...args);
    if (args[1] === mine && typeof done === 'number' && done > 0) healed += done;
    return done;
  }) as Battle['heal'];
  strike(setup, moveId);
  // A move that charges first (Fly, Dig, Skull Bash) strikes on the second turn: the move finds its own volatile there and goes on.
  if (mine.volatiles['twoturnmove'] && !setup.defender.fainted) strike(setup, moveId);
  const label = mine.status !== status ? mine.status : (mine.item && mine.item !== item ? `item:${mine.item}` : '');
  return { lost: Math.max(0, hp - mine.hp + healed) / mine.maxhp, label, setup };
}

/** The mean loss per turn of the attacker over the played end-of-turns of a setup, spent by it. */
function endOfTurn({ copy, attacker }: Setup): number {
  const bodies = slotsOf(copy);
  return playResiduals(copy, bodies)[bodies.indexOf(attacker)] ?? 0;
}

/** Whether the attacker moves on each of its next turns with the status the hit left on it, played on a copy with every draw answering `quantile`. */
function turnsActed(run: Run, moveId: string, quantile: number): boolean[] {
  const copy = copyOf(run.setup.copy);
  (copy as unknown as { debugMode: boolean }).debugMode = false;
  const attacker = counterpart(run.setup.copy, copy, run.setup.attacker);
  const defender = counterpart(run.setup.copy, copy, run.setup.defender);
  copy.prng = new FixedDice({ quantile });
  // The status is put on again under the dice of this play: the hit's own draws decided that it lands, and a sleep's length or a paralysis's turn would answer the same low quantile every time.
  attacker.clearStatus();
  attacker.setStatus(run.label, defender);
  const move = copy.dex.getActiveMove(moveId);
  return Array.from({ length: MAX_PRICED_HITS }, () => !!copy.runEvent('BeforeMove', attacker, defender, move));
}

/**
 * T225: the share of its next turns the attacker moves on with the status the hit left (BeforeMove of the simulator, the
 * grid of quantiles), turn by turn; undefined where the status never stops a move at the two probes (a burn, a poison).
 */
function actsOf(run: Run, moveId: string): number[] | undefined {
  try {
    const probes = PROBES.map(point => turnsActed(run, moveId, quantileOf(point)));
    if (probes.every(turns => turns.every(Boolean))) return undefined;
    const grid = Array.from({ length: GRID }, (_, point) => (PROBES.includes(point) ? probes[PROBES.indexOf(point)] : turnsActed(run, moveId, quantileOf(point))));
    return Array.from({ length: MAX_PRICED_HITS }, (_, turn) => mean(grid.map(turns => (turns[turn] ? 1 : 0))));
  } catch {
    return undefined;
  }
}

/**
 * What a status (or an item taken over) the hit left costs the attacker: the loss per turn it adds at the end of the
 * turn, played on the copy of the hit against a copy of the board before it, the share of its damage the same
 * move still deals, from the simulator's damage with and without the status, and the turns the status takes.
 */
function costOfLabel(run: Run, moveId: string, baseline: () => number): { chip: number; output: number; acts?: number[] } {
  const { copy, attacker, defender } = run.setup;
  let output = 1;
  if (attacker.status && run.label === attacker.status) {
    const statused = damageOf(copy, attacker, defender, moveId);
    const status = attacker.status;
    attacker.status = '';
    const plain = damageOf(copy, attacker, defender, moveId);
    attacker.status = status;
    if (plain > 0) output = statused / plain;
  }
  const acts = attacker.status && run.label === attacker.status ? actsOf(run, moveId) : undefined;
  return { chip: endOfTurn(run.setup) - baseline(), output, ...(acts ? { acts } : {}) };
}

/**
 * Whether the move costs its user HP by itself, played once on a pair stripped of items, abilities and typing (the
 * move's own recoil, crash or self-destruct, including what the simulator does in code and the Dex does not list:
 * Chloroblast). Not memoized; score/contact.ts asks once per move and format.
 */
export function hurtsItsUser(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string): boolean {
  try {
    return playRun(battle, attacker, defender, moveId, quantileOf(MIDDLE), true).lost > 0;
  } catch {
    return false;
  }
}

/** The probes agree on the status the hit leaves, and the move does not roll its number of hits. */
const deterministic = (probes: readonly Run[], rollsHits: boolean): boolean =>
  !rollsHits && probes.every(run => run.label === probes[0].label);

/**
 * The cost of one hit of `moveId` from `attacker` on `defender`, played on copies of `battle` (which it leaves alone).
 * Not memoized and not filtered; score/contact.ts is the reader the races use. `onRun` is told of every copy played.
 * NO_COST where the play fails.
 */
export function playHit(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, onRun?: () => void): HitCost {
  try {
    const rollsHits = !!battle.dex.moves.getByID(moveId as ID).multihit;
    const run = (point: number): Run => {
      onRun?.();
      return playRun(battle, attacker, defender, moveId, quantileOf(point));
    };
    const probes = PROBES.map(run);
    const runs = deterministic(probes, rollsHits)
      ? probes
      : Array.from({ length: GRID }, (_, point) => (PROBES.includes(point) ? probes[PROBES.indexOf(point)] : run(point)));
    let baseline: number | undefined;
    const before = (): number => (baseline ??= endOfTurn(prepare(battle, attacker, defender)));
    const statuses: StatusCost[] = [];
    for (const label of [...new Set(runs.map(entry => entry.label))].filter(Boolean).sort()) {
      const chance = runs.filter(entry => entry.label === label).length / runs.length;
      statuses.push({ status: label, chance, ...costOfLabel(runs.find(entry => entry.label === label)!, moveId, before) });
    }
    const lost = mean(runs.map(entry => entry.lost));
    return lost === 0 && statuses.length === 0 ? NO_COST : { chip: lost, statuses };
  } catch {
    return NO_COST;
  }
}
