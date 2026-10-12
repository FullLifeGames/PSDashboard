import { Battle, Teams, toID, type BoostsTable, type Pokemon, type PokemonSet, type Side } from '@pkmn/sim';
import { isChampionsSimFormat } from '../forward/sim-mods.ts';
import { movesFirst } from '../speed.ts';
import { EVAL_WEIGHTS } from './weights.ts';
import { boostedFraction, livingMons, livingOf, usableSlots, type PairThreat } from './threat.ts';
import { raceClocks, raceSide } from './races.ts';

/**
 * Round 69 (T49, decision 16): boostsBiting, `boosts` with every standing
 * stage damped by the share of living foes it bites. A stage bites a foe when
 * the foe leaves it alone and the stage moves the 1v1 race within BITE_TURNS:
 * it shortens the mon's clock to the KO, lengthens the foe's, or hands the
 * mon the first move in a race somebody wins. It does not bite a foe that
 * plays Unaware (the simulator's own ModifyBoost answers, with the mon and the
 * foe as attacker and target), that can click a move that takes the stages
 * away (removesStages, played in the simulator), or that a wall holds anyway.
 */

/** The race horizon, in turns: beyond three hits to a KO the pair is a stall war, not a sweep. */
const BITE_TURNS = 3;

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
    const twin = new Battle({
      formatid: toID(format), seed: '1,2,3,4',
      p1: { name: 'Target', team: Teams.pack(benched ? [target(), target()] : [target()]) },
      p2: { name: 'Foe', team: Teams.pack([body('Snorlax', [moveId, 'tackle'])]) },
    });
    if (twin.sides.some(side => side.requestState === 'teampreview')) {
      twin.choose('p1', benched ? 'team 12' : 'team 1');
      twin.choose('p2', 'team 1');
    }
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

/** The stages of one pair as each attack sees them: mine and the foe's when I hit, and again when the foe hits. */
interface PairStages { mineHitting: BoostsTable; foeDefending: BoostsTable; foeHitting: BoostsTable; mineDefending: BoostsTable }

const pairStages = (battle: Battle, mine: Pokemon, foe: Pokemon): PairStages => ({
  mineHitting: stagesSeen(battle, mine, mine, foe),
  foeDefending: stagesSeen(battle, foe, mine, foe),
  foeHitting: stagesSeen(battle, foe, foe, mine),
  mineDefending: stagesSeen(battle, mine, foe, mine),
});

const viewOf = (pokemon: Pokemon, boosts: BoostsTable): Pokemon => Object.create(pokemon, { boosts: { value: boosts } }) as Pokemon;

interface Race { turnsMine: number; turnsFoe: number; first: boolean }

/** The 1v1 race of the pair on these stages: both clocks and who moves first. */
function raceOn(
  mine: Pokemon, foe: Pokemon, mineThreat: PairThreat, foeThreat: PairThreat, battle: Battle, stages: PairStages,
): Race {
  const mineHitting = viewOf(mine, stages.mineHitting);
  const foeHitting = viewOf(foe, stages.foeHitting);
  const clocks = raceClocks(
    raceSide(mine, mine.hp / mine.maxhp, boostedFraction(mineThreat, mineHitting, viewOf(foe, stages.foeDefending)), battle),
    raceSide(foe, foe.hp / foe.maxhp, boostedFraction(foeThreat, foeHitting, viewOf(mine, stages.mineDefending)), battle),
  );
  return {
    turnsMine: clocks.turnsA, turnsFoe: clocks.turnsB,
    first: movesFirst(mineHitting, foeHitting, mineThreat, foeThreat, battle),
  };
}

/** Whether the stage moves the race: a nearer KO of the foe, a later KO of me, or the first move in a race somebody wins. */
function movesRace(held: Race, without: Race): boolean {
  if (held.turnsMine < without.turnsMine && held.turnsMine <= BITE_TURNS) return true;
  if (held.turnsFoe > without.turnsFoe && without.turnsFoe <= BITE_TURNS) return true;
  return held.first && !without.first && Math.min(held.turnsMine, held.turnsFoe) <= BITE_TURNS;
}

const withoutStat = (stages: PairStages, stat: keyof BoostsTable): PairStages => ({
  mineHitting: { ...stages.mineHitting, [stat]: 0 },
  foeDefending: stages.foeDefending,
  foeHitting: stages.foeHitting,
  mineDefending: { ...stages.mineDefending, [stat]: 0 },
});

type ThreatOf = (attacker: Pokemon, defender: Pokemon) => PairThreat;

/** The stats of a mon that carry a stage and bite the foe, by the race (accuracy and evasion by the stage the foe leaves them). */
function bitingStats(mine: Pokemon, foe: Pokemon, battle: Battle, threat: ThreatOf): (keyof BoostsTable)[] {
  const stats = (Object.keys(mine.boosts) as (keyof BoostsTable)[]).filter(stat => mine.boosts[stat]);
  const stages = pairStages(battle, mine, foe);
  const mineThreat = threat(mine, foe);
  const foeThreat = threat(foe, mine);
  const held = raceOn(mine, foe, mineThreat, foeThreat, battle, stages);
  return stats.filter(stat => {
    if (!stages.mineHitting[stat] && !stages.mineDefending[stat]) return false;
    if (stat === 'accuracy' || stat === 'evasion') return true;
    const without = raceOn(mine, foe, mineThreat, foeThreat, battle, withoutStat(stages, stat));
    return movesRace(held, without);
  });
}

/** One side's standing stages, each valued as `boosts` values it and counted for the share of living foes it bites. */
export function boostBiteValue(side: Side, sideIndex: 0 | 1, battle: Battle, threat: ThreatOf): number {
  const actives = side.active.filter((mon): mon is Pokemon => !!mon && !mon.fainted && Object.values(mon.boosts).some(Boolean));
  if (actives.length === 0) return 0;
  const foes = livingMons(battle, 1 - sideIndex);
  if (foes.length === 0) return 0;
  const benched = livingOf(side).some(mon => !mon.isActive);
  const twin = removalFormat(battle);
  const leaving = foes.filter(foe => !usableSlots(foe).some(slot => removesStages(twin, slot.id, benched)));
  let value = 0;
  for (const mine of actives) {
    for (const foe of leaving) {
      for (const stat of bitingStats(mine, foe, battle, threat)) {
        value += stageValue(mine, stat, mine.boosts[stat]) / foes.length;
      }
    }
  }
  return value;
}
