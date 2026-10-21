import type { Battle, BoostsTable, Pokemon, PokemonSet, Side } from '@pkmn/sim';
import { isChampionsSimFormat } from '../forward/sim-mods.ts';
import { twinBattle } from '../sim-ask/index.ts';
import { EVAL_WEIGHTS } from './weights.ts';
import { livingMons, livingOf, usableSlots } from './threat.ts';
import {
  BITE_TURNS, foeWins, holderActs, holderWins, idleHolders, pairRace, raceBodies, stageBites, type Bodies, type PairRace, type ThreatOf,
} from './boost-race.ts';
import { residualReader, type Residuals } from './residuals.ts';
import { hitReader, type HitReader } from './contact.ts';

/**
 * Round 69 (T49, decision 16): boostsBiting, `boosts` with every standing
 * stage damped by the share of living foes it bites. A stage bites a foe when
 * the foe leaves it alone and the stage moves the 1v1 race of the pair
 * within BITE_TURNS in favour of the side it helps (score/boost-race.ts): the
 * holder wins the race with it, gets to act, and it made the difference. It
 * does not bite a foe that plays Unaware (the simulator's own ModifyBoost
 * answers, with the mon and the foe as attacker and target), that can click a
 * move that takes the stages away (removesStages, played in the simulator),
 * or that a wall holds anyway.
 *
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320): the foes in
 * front of the holder gate the whole stage. A stage means nothing to a foe the
 * holder does not live to meet: while a foe on the field can take the stages
 * away or KOs the holder before it acts, no foe counts for a boost; while a
 * foe on the field wins the race within the horizon, no foe off the field
 * counts for any stage (the bench is credited only behind a front the holder
 * survives; T218) and, T225, while the holder does not win the race against a
 * foe on the field within the horizon (a wall it needs six turns for keeps the
 * bench shut, though it cannot KO the holder either).
 */

/** The value of one standing stage: sign, stat weight, schedule and status discount of the boosts term. */
export function stageValue(active: Pokemon, stat: string, stage: number): number {
  const statusDiscount = EVAL_WEIGHTS.boostStatusDiscount[active.status] ?? 1;
  // Defensive stages read at half the offensive weight (12 vs 6).
  const statWeight = stat === 'atk' || stat === 'spa' || stat === 'spe' ? 1 : 0.5;
  const magnitude = EVAL_WEIGHTS.boostSchedule[Math.min(Math.abs(stage), 6)];
  return Math.sign(stage) * statWeight * magnitude * statusDiscount;
}

const body = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

/**
 * The format of the twin battle that answers for `battle`: a singles custom game of the battle's generation, on the
 * Champions mod when the battle runs on it (the mode decides what a move does to a stage; the mod is registered
 * already, the battle stands on it).
 */
export function removalFormat(battle: Battle): string {
  return `gen${battle.gen}${isChampionsSimFormat(battle.format.id) ? 'champions' : ''}customgame`;
}

/** Whether the stages of a boosted mon are gone after a foe clicks the move at it, played once on a twin battle. */
function playedRemoval(format: string, moveId: string, benched: boolean): boolean {
  try {
    const target = () => body('Chansey', ['tackle']);
    const twin = twinBattle(format, {
      p1: { name: 'Target', team: benched ? [target(), target()] : [target()] },
      p2: { name: 'Foe', team: [body('Snorlax', [moveId, 'tackle'])] },
    });
    const boosted = twin.sides[0].active[0];
    boosted.boosts.atk = 2;
    boosted.boosts.spe = 2;
    const user = twin.sides[1].active[0];
    // A charging move plays its second turn too.
    for (let turn = 0; turn < 2 && !twin.ended; turn++) {
      if (!twin.choose('p2', turn === 0 ? 'move 1' : 'default')) return false;
      twin.choose('p1', turn === 0 ? 'move 1' : 'default');
      if (!user.volatiles['twoturnmove'] && !user.volatiles['mustrecharge']) break;
    }
    if (boosted.fainted) return false;
    const now = twin.sides[0].active[0];
    return now !== boosted || !Object.values(now.boosts).some(stage => stage > 0);
  } catch {
    return false;
  }
}

const removals = new Map<string, boolean>();

/**
 * Whether a move takes the positive stages off a boosted mon, as the
 * simulator plays it (Haze, Clear Smog, Freezy Frost, Topsy-Turvy, Heart Swap
 * and the moves that drag the mon out: those only with a bench behind it).
 * The Dex names the dragging moves (forceSwitch) and carries no flag for the
 * rest, so the answer is the played twin battle, once per twin format, move and
 * bench; test/boost-bite.spec.ts plays every move in singles and doubles
 * against it, on the base mode and on the Champions mod (`format` is the
 * twin's, from removalFormat).
 */
export function removesStages(format: string, moveId: string, benched: boolean): boolean {
  const key = `${format}|${moveId}|${benched}`;
  let removed = removals.get(key);
  if (removed === undefined) {
    removed = playedRemoval(format, moveId, benched);
    removals.set(key, removed);
  }
  return removed;
}

/** The stats of a mon that carry a stage. */
const stagedStats = (mine: Pokemon): (keyof BoostsTable)[] =>
  (Object.keys(mine.boosts) as (keyof BoostsTable)[]).filter(stat => mine.boosts[stat]);

/** Whether the stage of one stat bites the foe of this pair: the foe leaves it standing and it moves the race (accuracy and evasion bite by the stage the foe leaves them). */
function statBites(pair: PairRace, stat: keyof BoostsTable, drop: boolean): boolean {
  const { stages } = pair;
  if (!stages.mineHitting[stat] && !stages.mineDefending[stat]) return false;
  if (stat === 'accuracy' || stat === 'evasion') return true;
  return stageBites(pair.held, pair.without(stat), drop, pair.full);
}

/** What the foes on the field leave of a holder's stages: boosts at all, and any stage for the foes off the field. */
interface Gate { boosts: boolean; bench: boolean }

function frontGate(front: Pokemon[], removers: ReadonlySet<Pokemon>, raceWith: (foe: Pokemon) => PairRace): Gate {
  const gate: Gate = { boosts: true, bench: true };
  for (const foe of front) {
    const { held } = raceWith(foe);
    if (removers.has(foe) || !holderActs(held)) gate.boosts = false;
    if (!holderWins(held) || (foeWins(held) && held.turnsFoe <= BITE_TURNS)) gate.bench = false;
  }
  return gate;
}

/** The value of one holder's stages, summed over the foes each of them bites. */
function holderBites(
  mine: Pokemon, foes: Pokemon[], removers: ReadonlySet<Pokemon>, idle: ReadonlySet<Pokemon>, battle: Battle, threat: ThreatOf,
  bodies: Bodies, hits: HitReader,
): number {
  const stats = stagedStats(mine);
  const races = new Map<Pokemon, PairRace>();
  const raceWith = (foe: Pokemon): PairRace => {
    let race = races.get(foe);
    if (!race) {
      race = pairRace(mine, foe, battle, threat, bodies, hits, idle.has(foe));
      races.set(foe, race);
    }
    return race;
  };
  const gate = frontGate(foes.filter(foe => foe.isActive), removers, raceWith);
  let value = 0;
  for (const foe of foes) {
    if (removers.has(foe) || (!foe.isActive && !gate.bench)) continue;
    const pair = raceWith(foe);
    for (const stat of stats) {
      const stage = mine.boosts[stat];
      if (stage > 0 && !gate.boosts) continue;
      if (statBites(pair, stat, stage < 0)) value += stageValue(mine, stat, stage);
    }
  }
  return value;
}

/**
 * One side's standing stages, each valued as `boosts` values it and counted for the share of living foes it bites. `idle`
 * names the bodies that never act (score/boost-race.ts, idleHolders): a foe among them hits with no raised attack.
 */
export function boostBiteValue(
  side: Side, sideIndex: 0 | 1, battle: Battle, threat: ThreatOf, residuals: Residuals = residualReader(battle),
  hits: HitReader = hitReader(battle), idle: ReadonlySet<Pokemon> = idleHolders(battle, threat),
): number {
  const actives = side.active.filter((mon): mon is Pokemon => !!mon && !mon.fainted && Object.values(mon.boosts).some(Boolean));
  if (actives.length === 0) return 0;
  const foes = livingMons(battle, 1 - sideIndex);
  if (foes.length === 0) return 0;
  const benched = livingOf(side).some(mon => !mon.isActive);
  const twin = removalFormat(battle);
  const removers = new Set(foes.filter(foe => usableSlots(foe).some(slot => removesStages(twin, slot.id, benched))));
  const bodies = raceBodies(battle, residuals);
  let value = 0;
  for (const mine of actives) value += holderBites(mine, foes, removers, idle, battle, threat, bodies, hits);
  return value / foes.length;
}
