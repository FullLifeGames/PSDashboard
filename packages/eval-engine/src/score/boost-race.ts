import type { Battle, BoostsTable, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed.ts';
import { bestMoveId, boostedFraction, type PairThreat } from './threat.ts';
import { healProfile, ppBudget, raceClocks, statusResidual, type RaceClocks, type RaceSide } from './races.ts';
import type { Residuals } from './residuals.ts';
import { NO_COST, type HitCost, type HitReader } from './contact.ts';
import { priceHit, type HitPrice } from './contact-price.ts';

// A stage bites when the side it helps wins the race, acts in it and made the difference (EVALUATION.md, race terms).

/** The race horizon, in turns: beyond three hits to a KO the pair is a stall war, not a sweep. */
export const BITE_TURNS = 3;

export interface PairStages { mineHitting: BoostsTable; foeDefending: BoostsTable; foeHitting: BoostsTable; mineDefending: BoostsTable }

export type ThreatOf = (attacker: Pokemon, defender: Pokemon) => PairThreat;

// The stages a hit sees go through the simulator's ModifyBoost event (Unaware, Simple).
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

const withoutFoeRaises = (stages: PairStages): PairStages =>
  ({ ...stages, foeHitting: { ...stages.foeHitting, atk: Math.min(stages.foeHitting.atk, 0), spa: Math.min(stages.foeHitting.spa, 0) } });

export const withoutStat = (stages: PairStages, stat: keyof BoostsTable): PairStages => ({
  mineHitting: { ...stages.mineHitting, [stat]: 0 },
  foeDefending: stages.foeDefending,
  foeHitting: stages.foeHitting,
  mineDefending: { ...stages.mineDefending, [stat]: 0 },
});

const viewOf = (pokemon: Pokemon, boosts: BoostsTable): Pokemon => Object.create(pokemon, { boosts: { value: boosts } }) as Pokemon;

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

export interface Race {
  turnsMine: number;
  turnsFoe: number;
  first: boolean;
  foeFirst: boolean;
  mineSurvives: boolean;
  foeSurvives: boolean;
}

interface Inputs { mineFrac: number; foeFrac: number; first: boolean; foeFirst: boolean; mineMove: string | null; foeMove: string | null }

const livesThrough = (hitFraction: number, hp: number): boolean => hitFraction < hp;

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

interface PairCost { mine: HitCost; foe: HitCost }

const isFree = (cost: HitCost): boolean => cost.chip === 0 && cost.statuses.length === 0;

const PRICING_PASSES = 2;

const paying = (body: Body, frac: number, price: HitPrice): RaceSide =>
  ({ ...body, frac: frac * price.output, residual: body.residual + price.residual, hp: body.hp + price.buffer });

// A chip does not depend on the clocks (one pass); a status chance does (two passes, the second on the first's clocks).
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

/** Test switch (default on): off, no hit is read and the races run without contact costs. */
export function setContactReads(on: boolean): void {
  contactReads = on;
}

/** Test switch (default both): whose hits are read, the holder's only or the foe's too. */
export function setContactSides(sides: 'holder' | 'both'): void {
  contactSides = sides;
}

let raceCut = true;

/** Test switch (default on): off, every stat runs its own race even where the race cannot differ. */
export function setRaceCut(on: boolean): void {
  raceCut = on;
}

/** `held` gates at the bodies' HP; `full` and `without` race at full HP with and without a stat's stage. */
export interface PairRace {
  stages: PairStages;
  held: Race;
  full: Race;
  without: (stat: keyof BoostsTable) => Race;
}

/** The race without a stat runs only where taking it off changes a damage or the move order; others share `held`. */
export function pairRace(
  mine: Pokemon, foe: Pokemon, battle: Battle, threat: ThreatOf, bodies: Bodies, hits: HitReader, idleFoe = false,
): PairRace {
  const stages = idleFoe ? withoutFoeRaises(pairStages(battle, mine, foe)) : pairStages(battle, mine, foe);
  const mineThreat = threat(mine, foe);
  const foeThreat = threat(foe, mine);
  const [mineBody, foeBody] = [bodies(mine), bodies(foe)];
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

interface Frame { own: number; other: number; first: boolean; acts: boolean }

const frameOf = (race: Race, helped: 'mine' | 'foe'): Frame => helped === 'mine'
  ? { own: race.turnsMine, other: race.turnsFoe, first: race.first, acts: race.first || race.mineSurvives }
  : { own: race.turnsFoe, other: race.turnsMine, first: race.foeFirst, acts: race.foeFirst || race.foeSurvives };

const wins = (frame: Frame): boolean =>
  frame.own < frame.other || (frame.own === frame.other && frame.own !== Infinity && frame.first);

export const foeWins = (race: Race): boolean => wins(frameOf(race, 'foe'));

export const holderActs = (race: Pick<Race, 'first' | 'mineSurvives'>): boolean => race.first || race.mineSurvives;

/** False when a foe in front moves first and takes the holder's HP with its best hit: the holder never acts. */
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

export const holderWins = (race: Race): boolean => wins(frameOf(race, 'mine')) && race.turnsMine <= BITE_TURNS;

export const withoutRaises = (pokemon: Pokemon): Pokemon =>
  Object.create(pokemon, { boosts: { value: Object.fromEntries(Object.entries(pokemon.boosts).map(([stat, stage]) => [stat, Math.min(stage, 0)])) } }) as Pokemon;

/** Bodies with a raised stage that never act, since a foe moves first and KOs them; pair terms read drops only. */
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

/** The stage moves the race for the side it helps: it wins within the horizon, acts, and won less without it. */
export function stageBites(held: Race, without: Race, drop: boolean, full: Race = held): boolean {
  const helped = drop ? 'foe' : 'mine';
  const now = frameOf(held, helped);
  if (!wins(now) || !now.acts || now.own > BITE_TURNS) return false;
  const [fresh, before] = [frameOf(full, helped), frameOf(without, helped)];
  return fresh.own < before.own || fresh.other > before.other || (fresh.first && !before.first);
}

/** The holder acts, has a finite clock, and the foe wins neither within the horizon nor the long race. */
export const holderHolds = (race: Race): boolean =>
  holderActs(race) && race.turnsMine < Infinity && race.turnsFoe > BITE_TURNS && !foeWins(race);

/** A positive stage takes the foe's win away: the foe wins the fresh race without it but not with it. */
export function stageShields(held: Race, without: Race, drop: boolean, full: Race = held): boolean {
  if (drop || !holderHolds(held)) return false;
  const before = frameOf(without, 'foe');
  const fresh = frameOf(full, 'foe');
  return wins(before) && before.own <= BITE_TURNS && fresh.own > BITE_TURNS && !wins(fresh);
}
