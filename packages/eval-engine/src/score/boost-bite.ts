import type { Battle, BoostsTable, Pokemon, PokemonSet, Side } from '@pkmn/sim';
import { isChampionsSimFormat } from '../forward/sim-mods.ts';
import { twinBattle } from '../sim-ask/index.ts';
import { EVAL_WEIGHTS } from './weights.ts';
import { livingMons, livingOf, usableSlots } from './threat.ts';
import {
  BITE_TURNS, foeWins, holderActs, holderWins, idleHolders, pairRace, raceBodies, stageBites, stageShields, type Bodies, type PairRace, type ThreatOf,
} from './boost-race.ts';
import { residualReader, type Residuals } from './residuals.ts';
import { hitReader, type HitReader } from './contact.ts';
import { stageStands } from './switch-out.ts';

// A stage bites a foe when the foe leaves it alone and it moves the 1v1 race within BITE_TURNS (score/boost-race.ts).
// Not a foe that plays Unaware (ModifyBoost) or can take the stages away. A drop counts while its holder can't leave.

export function stageValue(active: Pokemon, stat: string, stage: number): number {
  const statusDiscount = EVAL_WEIGHTS.boostStatusDiscount[active.status] ?? 1;
  const statWeight = stat === 'atk' || stat === 'spa' || stat === 'spe' ? 1 : 0.5;
  const magnitude = EVAL_WEIGHTS.boostSchedule[Math.min(Math.abs(stage), 6)];
  return Math.sign(stage) * statWeight * magnitude * statusDiscount;
}

const body = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

/** The twin battle's format: a singles custom game of the battle's generation, on the Champions mod where it runs. */
export function removalFormat(battle: Battle): string {
  return `gen${battle.gen}${isChampionsSimFormat(battle.format.id) ? 'champions' : ''}customgame`;
}

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

/** Whether a move removes raised stages: the Dex has no flag for it, so a twin battle plays it (per format, move). */
export function removesStages(format: string, moveId: string, benched: boolean): boolean {
  const key = `${format}|${moveId}|${benched}`;
  let removed = removals.get(key);
  if (removed === undefined) {
    removed = playedRemoval(format, moveId, benched);
    removals.set(key, removed);
  }
  return removed;
}

const stagedStats = (mine: Pokemon): (keyof BoostsTable)[] =>
  (Object.keys(mine.boosts) as (keyof BoostsTable)[]).filter(stat => mine.boosts[stat]);

const shieldStat = (stat: keyof BoostsTable): boolean => stat === 'def' || stat === 'spd';

function statBites(pair: PairRace, stat: keyof BoostsTable, drop: boolean): boolean {
  const { stages } = pair;
  if (!stages.mineHitting[stat] && !stages.mineDefending[stat]) return false;
  if (stat === 'accuracy' || stat === 'evasion') return true;
  const without = pair.without(stat);
  return stageBites(pair.held, without, drop, pair.full) || (shieldStat(stat) && stageShields(pair.held, without, drop, pair.full));
}

interface Gate { boosts: boolean; bench: boolean }

function frontGate(front: Pokemon[], removers: ReadonlySet<Pokemon>, raceWith: (foe: Pokemon) => PairRace, shielded: (pair: PairRace) => boolean): Gate {
  const gate: Gate = { boosts: true, bench: true };
  for (const foe of front) {
    const pair = raceWith(foe);
    const { held } = pair;
    if (removers.has(foe) || !holderActs(held)) gate.boosts = false;
    const won = holderWins(held) && !(foeWins(held) && held.turnsFoe <= BITE_TURNS);
    if (!won && !shielded(pair)) gate.bench = false;
  }
  return gate;
}

function holderBites(
  mine: Pokemon, foes: Pokemon[], removers: ReadonlySet<Pokemon>, idle: ReadonlySet<Pokemon>, battle: Battle, threat: ThreatOf,
  bodies: Bodies, hits: HitReader,
): number {
  const stats = stagedStats(mine).filter(stat => stageStands(battle, mine, mine.boosts[stat]));
  if (stats.length === 0) return 0;
  const races = new Map<Pokemon, PairRace>();
  const raceWith = (foe: Pokemon): PairRace => {
    let race = races.get(foe);
    if (!race) {
      race = pairRace(mine, foe, battle, threat, bodies, hits, idle.has(foe));
      races.set(foe, race);
    }
    return race;
  };
  const shielded = (pair: PairRace) => stats.some(stat => shieldStat(stat) && mine.boosts[stat] > 0 && stageShields(pair.held, pair.without(stat), false, pair.full));
  const gate = frontGate(foes.filter(foe => foe.isActive), removers, raceWith, shielded);
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

/** `idle` names the bodies that never act (idleHolders in boost-race.ts): such a foe hits with no raised attack. */
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
