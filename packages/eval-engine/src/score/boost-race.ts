import type { Battle, BoostsTable, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed.ts';
import { bestMoveId, boostedFraction, type PairThreat } from './threat.ts';
import { healProfile, ppBudget, raceClocks, statusResidual, type RaceClocks, type RaceSide } from './races.ts';
import type { Residuals } from './residuals.ts';
import { NO_COST, type HitCost, type HitReader } from './contact.ts';
import { priceHit, type HitPrice } from './contact-price.ts';

/**
 * The 1v1 race behind boostsBiting (score/boost-bite.ts): both KO clocks and the
 * move order of one pair on the stages each attack sees, and the rule that says
 * whether a stage moves that race in its holder's favour (13.10.2026, the Swords
 * Dance report on gen9draft-2058494320).
 *
 * A stage counts against a foe only when the side it helps WINS the race with it,
 * gets to act in it, and the stage made the difference: it turned a lost race into
 * a won one, or the win into a faster one. A shorter clock in a race the holder
 * loses anyway is no bite (a Scarf Mienshao that moves first and KOs the holder
 * in one hit stops +4 Attack from biting it, however many hits the stage saved).
 * A drop is the mirror: it is the foe's stage, so the foe must win the race with
 * it, get to act, and win by it (a flip, or a faster win); a drop in a race the
 * holder still wins costs nothing.
 *
 * Both sides pay for their hits (13.10.2026, Cobalion's contact moves into Talonflame meet Flame Body): the HP a hit
 * takes from its attacker (Rocky Helmet, Rough Skin, Iron Barbs, recoil, Life Orb) joins the attacker's residual, and
 * the status it can leave (a burn, a poison) joins as expected end-of-turn damage and expected lost damage. The
 * simulator reads the hit (score/contact.ts); score/contact-price.ts prices it into the race: a chip is paid after
 * every hit, so the side that moves second is a chip better off than a plain residual says (the other side's hit comes
 * first), and a status compounds over the hits the clocks of the race without it give the side. pricedClocks runs the race
 * again on the price.
 */

/** The race horizon, in turns: beyond three hits to a KO the pair is a stall war, not a sweep. */
export const BITE_TURNS = 3;

/** The stages of one pair as each attack sees them: mine and the foe's when I hit, and again when the foe hits. */
export interface PairStages { mineHitting: BoostsTable; foeDefending: BoostsTable; foeHitting: BoostsTable; mineDefending: BoostsTable }

export type ThreatOf = (attacker: Pokemon, defender: Pokemon) => PairThreat;

/** The stages `mon` carries in a hit of `attacker` on `defender`, as the simulator's ModifyBoost event leaves them (Unaware, Simple). */
function stagesSeen(battle: Battle, mon: Pokemon, attacker: Pokemon, defender: Pokemon): BoostsTable {
  const { activePokemon, activeTarget } = battle;
  battle.activePokemon = attacker;
  battle.activeTarget = defender;
  try {
    return battle.runEvent('ModifyBoost', mon, null, null, { ...mon.boosts }) as BoostsTable;
  } finally {
    battle.activePokemon = activePokemon;
    battle.activeTarget = activeTarget;
  }
}

export const pairStages = (battle: Battle, mine: Pokemon, foe: Pokemon): PairStages => ({
  mineHitting: stagesSeen(battle, mine, mine, foe),
  foeDefending: stagesSeen(battle, foe, mine, foe),
  foeHitting: stagesSeen(battle, foe, foe, mine),
  mineDefending: stagesSeen(battle, mine, foe, mine),
});

/** The pair's stages with the foe's raised attack and special attack taken off (T249: a foe that never acts hits with nothing it raised). */
const withoutFoeRaises = (stages: PairStages): PairStages =>
  ({ ...stages, foeHitting: { ...stages.foeHitting, atk: Math.min(stages.foeHitting.atk, 0), spa: Math.min(stages.foeHitting.spa, 0) } });

export const withoutStat = (stages: PairStages, stat: keyof BoostsTable): PairStages => ({
  mineHitting: { ...stages.mineHitting, [stat]: 0 },
  foeDefending: stages.foeDefending,
  foeHitting: stages.foeHitting,
  mineDefending: { ...stages.mineDefending, [stat]: 0 },
});

const viewOf = (pokemon: Pokemon, boosts: BoostsTable): Pokemon => Object.create(pokemon, { boosts: { value: boosts } }) as Pokemon;

/**
 * What a body brings to every race it runs in one evaluation, whatever stages stand: its HP, its heal moves and
 * PP, and the HP it gains or loses at the end of every turn. Read once per body (T221: the races of a pair, one
 * per stat, used to read them again each time); the end-of-turn reading is the simulator's for an active body
 * (score/residuals.ts) and the status table for a benched one.
 */
export type Body = Omit<RaceSide, 'frac'>;
export type Bodies = (pokemon: Pokemon) => Body;

export function raceBodies(battle: Battle, residuals: Residuals): Bodies {
  const memo = new Map<Pokemon, Body>();
  return pokemon => {
    let body = memo.get(pokemon);
    if (!body) {
      const heal = healProfile(pokemon, battle);
      body = {
        hp: pokemon.hp / pokemon.maxhp, residual: residuals(pokemon) ?? statusResidual(pokemon),
        healRate: heal.rate, healAbsorb: heal.absorb, ppBudget: ppBudget(pokemon),
      };
      memo.set(pokemon, body);
    }
    return body;
  };
}

/** The 1v1 race of the pair on some stages: both clocks, who moves first, and whether each side lives through the other's hit. */
export interface Race {
  turnsMine: number;
  turnsFoe: number;
  first: boolean;
  foeFirst: boolean;
  /** The foe's best hit leaves me standing. */
  mineSurvives: boolean;
  /** My best hit leaves the foe standing. */
  foeSurvives: boolean;
}

/**
 * What a stage set changes in a race: the damage fractions of both sides, who moves first, and the move each side
 * hits with (the clocks follow from them, and the cost of the hit from the move).
 */
interface Inputs { mineFrac: number; foeFrac: number; first: boolean; foeFirst: boolean; mineMove: string | null; foeMove: string | null }

/** Whether a side lives through the other's best hit: that hit leaves some of its HP (a share of the maximum). */
const livesThrough = (hitFraction: number, hp: number): boolean => hitFraction < hp;

/** The stages of a pair as each attack of the race sees the two bodies. */
function viewsOn(mine: Pokemon, foe: Pokemon, stages: PairStages) {
  return {
    mineHitting: viewOf(mine, stages.mineHitting),
    foeHitting: viewOf(foe, stages.foeHitting),
    foeDefending: viewOf(foe, stages.foeDefending),
    mineDefending: viewOf(mine, stages.mineDefending),
  };
}

function inputsOn(mine: Pokemon, foe: Pokemon, mineThreat: PairThreat, foeThreat: PairThreat, battle: Battle, stages: PairStages): Inputs {
  const { mineHitting, foeHitting, foeDefending, mineDefending } = viewsOn(mine, foe, stages);
  return {
    mineFrac: boostedFraction(mineThreat, mineHitting, foeDefending),
    foeFrac: boostedFraction(foeThreat, foeHitting, mineDefending),
    first: movesFirst(mineHitting, foeHitting, mineThreat, foeThreat, battle),
    foeFirst: movesFirst(foeHitting, mineHitting, foeThreat, mineThreat, battle),
    mineMove: contactReads ? bestMoveId(mineThreat, mineHitting, foeDefending) : null,
    foeMove: contactReads && contactSides === 'both' ? bestMoveId(foeThreat, foeHitting, mineDefending) : null,
  };
}

/** What the hits of the two sides cost them. */
interface PairCost { mine: HitCost; foe: HitCost }

const isFree = (cost: HitCost): boolean => cost.chip === 0 && cost.statuses.length === 0;

/**
 * How often a race with a status chance in it is priced again against the clocks the last price gave: the expected
 * burn of a side depends on the hits it lands and the turns the other side needs, and those follow from the price.
 */
const PRICING_PASSES = 2;

/** One side of the race as it pays for its hits (score/contact-price.ts): the chip and the expected status in its residual, the burn in its damage, the buffer in its HP. */
const paying = (body: Body, frac: number, price: HitPrice): RaceSide =>
  ({ ...body, frac: frac * price.output, residual: body.residual + price.residual, hp: body.hp + price.buffer });

/**
 * The clocks of the race with the cost of both sides' hits in it. The race without the costs says how many hits each
 * side lands and how many turns it has to live; the price of the hits goes into the residual, the damage and the HP of
 * its side, and the race is run again on them. A chip alone does not depend on the clocks (one pass); a status chance
 * does (two passes, the second against the clocks the first gave).
 */
function pricedClocks(inputs: Inputs, mine: Body, foe: Body, cost: PairCost): RaceClocks {
  let clocks = raceClocks({ ...mine, frac: inputs.mineFrac }, { ...foe, frac: inputs.foeFrac });
  if (isFree(cost.mine) && isFree(cost.foe)) return clocks;
  const passes = cost.mine.statuses.length > 0 || cost.foe.statuses.length > 0 ? PRICING_PASSES : 1;
  for (let pass = 0; pass < passes; pass++) {
    const minePrice = priceHit(cost.mine, clocks.turnsA, clocks.turnsB, inputs.first);
    const foePrice = priceHit(cost.foe, clocks.turnsB, clocks.turnsA, inputs.foeFirst);
    clocks = raceClocks(paying(mine, inputs.mineFrac, minePrice), paying(foe, inputs.foeFrac, foePrice));
  }
  return clocks;
}

function raceOf(inputs: Inputs, mine: Body, foe: Body, cost: PairCost): Race {
  const clocks = pricedClocks(inputs, mine, foe, cost);
  return {
    turnsMine: clocks.turnsA, turnsFoe: clocks.turnsB, first: inputs.first, foeFirst: inputs.foeFirst,
    mineSurvives: livesThrough(inputs.foeFrac, mine.hp), foeSurvives: livesThrough(inputs.mineFrac, foe.hp),
  };
}

const sameInputs = (a: Inputs, b: Inputs): boolean =>
  a.mineFrac === b.mineFrac && a.foeFrac === b.foeFrac && a.first === b.first && a.foeFirst === b.foeFirst &&
  a.mineMove === b.mineMove && a.foeMove === b.foeMove;

let contactReads = true;
let contactSides: 'holder' | 'both' = 'both';

/** Test switch (default on): off, no hit is read and the races are as before the contact punishments. */
export function setContactReads(on: boolean): void {
  contactReads = on;
}

/** Test switch (default both): whose hits are read, the holder's only or the foe's too. */
export function setContactSides(sides: 'holder' | 'both'): void {
  contactSides = sides;
}

let raceCut = true;

/** Test switch of the T221 cut (default on): off, every stat runs its own race even where the race cannot differ. */
export function setRaceCut(on: boolean): void {
  raceCut = on;
}

/**
 * One pair's races. `held` is the race on all the stages standing, at the HP the bodies have (it gates: who wins, who acts,
 * who closes the bench). `full` is the same race with both bodies at full HP, and `without` the race at full HP without
 * one stat's stage: the pair of them says whether the stage decides a fresh race (T248, round 73). Read at the HP the
 * bodies have, "the stage made the difference" started and stopped at single HP points (a defensive stage only decides
 * the race inside a range of HP, a clock only differs above the HP where both need one hit), so a hit you take could raise
 * your grade and a hit you land could lower it; at full HP it is a property of the pair and the HP enters only through
 * the gates, which are monotone.
 */
export interface PairRace {
  stages: PairStages;
  held: Race;
  full: Race;
  without: (stat: keyof BoostsTable) => Race;
}

/**
 * The pair's races. The race on the stages standing is run once for all stats (T221); the race without a stat is run
 * only where taking the stat off changes what the race reads: the damage of a side or the move order. A stat that
 * no move reads (Attack on a special attacker) leaves the inputs as they were and shares the race on all stages.
 */
export function pairRace(
  mine: Pokemon, foe: Pokemon, battle: Battle, threat: ThreatOf, bodies: Bodies, hits: HitReader, idleFoe = false,
): PairRace {
  const stages = idleFoe ? withoutFoeRaises(pairStages(battle, mine, foe)) : pairStages(battle, mine, foe);
  const mineThreat = threat(mine, foe);
  const foeThreat = threat(foe, mine);
  const [mineBody, foeBody] = [bodies(mine), bodies(foe)];
  // The races of one pair mostly hit with the same moves: the last cost is kept for them.
  let last: { mineMove: string | null; foeMove: string | null; cost: PairCost } | undefined;
  const costOf = (inputs: Inputs): PairCost => {
    if (last && last.mineMove === inputs.mineMove && last.foeMove === inputs.foeMove) return last.cost;
    const cost = { mine: hits(mine, foe, inputs.mineMove), foe: inputs.foeMove ? hits(foe, mine, inputs.foeMove) : NO_COST };
    last = { mineMove: inputs.mineMove, foeMove: inputs.foeMove, cost };
    return cost;
  };
  const heldInputs = inputsOn(mine, foe, mineThreat, foeThreat, battle, stages);
  const held = raceOf(heldInputs, mineBody, foeBody, costOf(heldInputs));
  const [mineFull, foeFull] = [{ ...mineBody, hp: 1 }, { ...foeBody, hp: 1 }];
  const full = mineBody.hp === 1 && foeBody.hp === 1 ? held : raceOf(heldInputs, mineFull, foeFull, costOf(heldInputs));
  return {
    stages, held, full,
    without: stat => {
      const inputs = inputsOn(mine, foe, mineThreat, foeThreat, battle, withoutStat(stages, stat));
      return raceCut && sameInputs(inputs, heldInputs) ? full : raceOf(inputs, mineFull, foeFull, costOf(inputs));
    },
  };
}

/** The race from the side a stage helps: its own clock, the other's, whether it moves first, whether it lives to act. */
interface Frame { own: number; other: number; first: boolean; acts: boolean }

const frameOf = (race: Race, helped: 'mine' | 'foe'): Frame => helped === 'mine'
  ? { own: race.turnsMine, other: race.turnsFoe, first: race.first, acts: race.first || race.mineSurvives }
  : { own: race.turnsFoe, other: race.turnsMine, first: race.foeFirst, acts: race.foeFirst || race.foeSurvives };

/** Who wins: the shorter clock, and on equal finite clocks whoever moves first. */
const wins = (frame: Frame): boolean =>
  frame.own < frame.other || (frame.own === frame.other && frame.own !== Infinity && frame.first);

/** Whether the foe wins the race (for the gates in front of the stage). */
export const foeWins = (race: Race): boolean => wins(frameOf(race, 'foe'));

/** Whether the holder gets to act in the race: it moves first, or it survives the foe's hit. */
export const holderActs = (race: Pick<Race, 'first' | 'mineSurvives'>): boolean => race.first || race.mineSurvives;

/**
 * T249 (round 73): whether the holder gets to act against every foe in front, read from the same pieces as the race
 * (the stages each attack sees, the move order, the foe's best hit against the holder's HP) and without its clocks or
 * a played hit. False when one foe on the field moves first and takes the holder's HP with its best hit: the holder
 * never acts, and what its stages would do is moot (the rule of the front gate of boostsBiting, here for every reader
 * of a stage). A holder without a foe in front acts.
 */
export function holderActsInFront(mine: Pokemon, front: readonly Pokemon[], battle: Battle, threat: ThreatOf): boolean {
  return front.every(foe => {
    const { mineHitting, foeHitting, mineDefending } = viewsOn(mine, foe, pairStages(battle, mine, foe));
    const [mineThreat, foeThreat] = [threat(mine, foe), threat(foe, mine)];
    return holderActs({
      first: movesFirst(mineHitting, foeHitting, mineThreat, foeThreat, battle),
      mineSurvives: livesThrough(boostedFraction(foeThreat, foeHitting, mineDefending), mine.hp / mine.maxhp),
    });
  });
}

/** Whether the holder wins the race within the race horizon (for the bench credit behind the foes in front). */
export const holderWins = (race: Race): boolean => wins(frameOf(race, 'mine')) && race.turnsMine <= BITE_TURNS;

/** The mon with its raised stages taken off and its drops kept: a view, as `unboosted`. */
export const withoutRaises = (pokemon: Pokemon): Pokemon =>
  Object.create(pokemon, { boosts: { value: Object.fromEntries(Object.entries(pokemon.boosts).map(([stat, stage]) => [stat, Math.min(stage, 0)])) } }) as Pokemon;

/**
 * T249 (round 73): the active bodies that carry a raised stage and never act, because a foe on the field moves first
 * and KOs them (score/boost-race.ts, holderActsInFront). What their raises would do to a pair is moot: the pair terms
 * read such a body on its drops only. Empty on a board without a raised stage.
 */
export function idleHolders(battle: Battle, threat: ThreatOf): ReadonlySet<Pokemon> {
  const idle = new Set<Pokemon>();
  for (const side of battle.sides) {
    const front = side.foe.active.filter((foe): foe is Pokemon => !!foe && !foe.fainted);
    for (const mon of side.active) {
      if (!mon || mon.fainted || !Object.values(mon.boosts).some(stage => stage > 0)) continue;
      if (!holderActsInFront(mon, front, battle, threat)) idle.add(mon);
    }
  }
  return idle;
}

/**
 * Whether the stage moves the race in favour of the side it helps (the holder for a boost, the foe for a drop): that
 * side wins the race with the stage, within the race horizon, and gets to act in it; and it did not win without the
 * stage, or won more slowly. A boost that hurts (Speed under Trick Room) is not read: it stays uncounted.
 *
 * T248 (round 73): `held` is the race at the HP the bodies have and gates (the side wins, acts, and wins within the
 * horizon at the HP it has). Whether the stage `made the difference` is read between `full` and `without`, both at full
 * HP (default: `held`, for the rule on a table of races), and it asks whether the stage improves the race for the side it
 * helps at all: a shorter clock of its own, a longer one for the other side, or the first move. Read at the HP the bodies
 * have, the question flipped at single HP points (a defensive stage decides the race only inside a range of the holder's
 * HP, a clock differs only above the foe's HP where both need one hit), so a hit you take could raise your grade and a
 * hit you land could lower it, by up to 0.15 in singles. A stage that improves the fresh race is worth having wherever the
 * HP puts the pair, and only the gate, which is monotone in both HPs, decides whether the pair is won.
 */
export function stageBites(held: Race, without: Race, drop: boolean, full: Race = held): boolean {
  const helped = drop ? 'foe' : 'mine';
  const now = frameOf(held, helped);
  if (!wins(now) || !now.acts || now.own > BITE_TURNS) return false;
  const [fresh, before] = [frameOf(full, helped), frameOf(without, helped)];
  return fresh.own < before.own || fresh.other > before.other || (fresh.first && !before.first);
}

/**
 * Round 79 (T288): whether the holder holds the front against the foe on the stages standing: it gets to act, it has a
 * finite clock of its own (the PP budget and the foe's heals are in it), and the foe wins neither within the race horizon
 * nor the long race. The holder need not win within BITE_TURNS: a wall that out-heals the foe's hits holds the front
 * whatever its own clock (Clefable behind +1/+1 needs fourteen turns against a resting Rhydon and is never KOed).
 */
export const holderHolds = (race: Race): boolean =>
  holderActs(race) && race.turnsMine < Infinity && race.turnsFoe > BITE_TURNS && !foeWins(race);

/**
 * Round 79 (T288), besides `stageBites`: whether a standing positive stage takes away the foe's win. Without the stage
 * the foe wins the fresh race within the horizon (`without`, at full HP); with it the foe's clock passes the horizon and
 * the foe does not win the long race either (`full`, at full HP); and the holder holds the front at the HP it has (`held`,
 * which gates: it acts and has a clock of its own). The offensive horizon stays: a stage that leaves the foe's clock
 * alone (an attacking stage) never shields. A drop is the foe's stage and shields nobody.
 */
export function stageShields(held: Race, without: Race, drop: boolean, full: Race = held): boolean {
  if (drop || !holderHolds(held)) return false;
  const before = frameOf(without, 'foe');
  const fresh = frameOf(full, 'foe');
  return wins(before) && before.own <= BITE_TURNS && fresh.own > BITE_TURNS && !wins(fresh);
}
