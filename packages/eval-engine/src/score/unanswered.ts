import type { Battle, ID, Pokemon } from '@pkmn/sim';
import { boundaryEvent } from '../ko-odds.ts';
import { movesFirst } from '../speed.ts';
import { stageMultiplier } from '../stat-stages.ts';
import type { DecidedSweep, EntryUnanswered, NearDecidedSweep, UnansweredProfile } from '../types.ts';
import { hazardEntryFraction } from './hazards.ts';
import {
  expectedFraction, livingMons, singleMoveFraction, threatGetter, usableSlots,
  type MatchupCache, type PairThreat, type ThreatGetter,
} from './threat.ts';
import { healProfile, ppBudget, raceClocks, statusResidual, type HealProfile, type RaceClocks, type RaceSide } from './races.ts';


interface ProfileContext {
  battle: Battle;
  threat: ThreatGetter;
  profiles: Map<Pokemon, HealProfile>;
  budgets: Map<Pokemon, number>;
}

/** Per-turn expected damage fraction: the category-max move at its accuracy, on the stages of each move's own stats. */
export function expectedRate(threatOut: PairThreat, attacker: Pokemon, defender: Pokemon): number {
  return expectedFraction(threatOut, attacker, defender);
}

function profileSide(ctx: ProfileContext, pokemon: Pokemon, threatOut: PairThreat, enemy: Pokemon): RaceSide {
  let profile = ctx.profiles.get(pokemon);
  if (!profile) { profile = healProfile(pokemon, ctx.battle); ctx.profiles.set(pokemon, profile); }
  let budget = ctx.budgets.get(pokemon);
  if (budget === undefined) { budget = ppBudget(pokemon); ctx.budgets.set(pokemon, budget); }
  const hp = pokemon.hp / pokemon.maxhp;
  return {
    hp: pokemon.isActive ? hp : Math.max(0, hp - hazardEntryFraction(pokemon, pokemon.side, ctx.battle)),
    frac: expectedRate(threatOut, pokemon, enemy),
    residual: statusResidual(pokemon),
    healRate: profile.rate, healAbsorb: profile.absorb, ppBudget: budget,
  };
}

function flinchChip(ctx: ProfileContext, standing: Pokemon, enemy: Pokemon): number {
  const slot = usableSlots(standing).find(entry => FIRST_TURN_FLINCH_MOVES.has(entry.id));
  if (!slot) return 0;
  return singleMoveFraction(standing, enemy, slot.id, ctx.battle) *
    stageMultiplier(standing.boosts.atk) / stageMultiplier(enemy.boosts.def);
}

// A first mover takes a finite tie only when its own hit finishes the last turn: a KO that needs the foe's burn or
// poison tick leaves the slower foe its action first, because the tick comes after both moves.
function firstTakesTie(sideA: RaceSide, sideB: RaceSide, clocks: RaceClocks, first: boolean): boolean {
  if (!first || clocks.turnsA === Infinity) return false;
  if (sideB.residual <= 0) return true;
  const incoming = sideA.frac + sideB.residual;
  const absorb = sideB.healRate > 0 && incoming > sideB.healRate ? sideB.healAbsorb * (sideB.healRate / incoming) : sideB.healAbsorb;
  const earlier = (clocks.turnsA - 1) * (clocks.effFracA + sideB.residual);
  return earlier + clocks.effFracA >= sideB.hp + absorb - 1e-9;
}

function beatsEntry(ctx: ProfileContext, standing: Pokemon, enemy: Pokemon): boolean {
  const threatS = ctx.threat(standing, enemy);
  const threatE = ctx.threat(enemy, standing);
  const sideS = profileSide(ctx, standing, threatS, enemy);
  const sideE = profileSide(ctx, enemy, threatE, standing);
  if (!enemy.isActive) sideE.hp = Math.max(0, sideE.hp - expectedRate(threatS, standing, enemy));
  else sideE.hp = Math.max(0, sideE.hp - flinchChip(ctx, standing, enemy));
  const clocks = raceClocks(sideS, sideE);
  if (clocks.turnsA < clocks.turnsB) return true;
  if (clocks.turnsB < clocks.turnsA) return false;
  return firstTakesTie(sideS, sideE, clocks, movesFirst(standing, enemy, threatS, threatE, ctx.battle));
}

function sideProfile(ctx: ProfileContext, mine: Pokemon[], theirs: Pokemon[]): { full: string[]; entry: EntryUnanswered[] } {
  const full: string[] = [];
  const entry: EntryUnanswered[] = [];
  const hasBench = theirs.some(enemy => !enemy.isActive);
  for (const mon of mine) {
    const verdicts = theirs.map(enemy => ({ enemy, beats: beatsEntry(ctx, mon, enemy) }));
    if (verdicts.every(verdict => verdict.beats)) { full.push(mon.species.name); continue; }
    if (!hasBench) continue;
    if (!verdicts.every(verdict => verdict.beats || verdict.enemy.isActive)) continue;
    const holder = verdicts.find(verdict => !verdict.beats)!.enemy;
    entry.push({ species: mon.species.name, heldBy: holder.species.name });
  }
  return { full, entry };
}

function sweepClocks(ctx: ProfileContext, mon: Pokemon, theirs: Pokemon[]): { turns: number; chip: number; blocked: boolean } {
  let turns = 0;
  let chip = 0;
  for (const enemy of theirs) {
    const threatS = ctx.threat(mon, enemy);
    const threatE = ctx.threat(enemy, mon);
    const first = movesFirst(mon, enemy, threatS, threatE, ctx.battle);
    const sideS = profileSide(ctx, mon, threatS, enemy);
    const sideE = profileSide(ctx, enemy, threatE, mon);
    const clocks = raceClocks(sideS, sideE);
    const wins = clocks.turnsA < clocks.turnsB ||
      (clocks.turnsA === clocks.turnsB && firstTakesTie(sideS, sideE, clocks, first));
    if (!wins) return { turns, chip, blocked: true };
    const hits = Math.max(0, clocks.turnsA - (first ? 1 : 0));
    turns += clocks.turnsA;
    chip += hits * clocks.effFracB;
  }
  return { turns, chip, blocked: false };
}

function sweepSurvivor(ctx: ProfileContext, mine: Pokemon[], theirs: Pokemon[]): string | null {
  const activeEnemy = theirs.find(enemy => enemy.isActive) ?? null;
  for (const mon of mine) {
    const { turns, chip, blocked } = sweepClocks(ctx, mon, theirs);
    if (blocked) continue;
    if (turns > DECIDED_MAX_TURNS) continue;
    const me = profileSide(ctx, mon, ctx.threat(mon, theirs[0]), theirs[0]);
    if (turns > me.ppBudget) continue;
    const entryHit = mon.isActive || !activeEnemy ? 0
      : expectedRate(ctx.threat(activeEnemy, mon), activeEnemy, mon);
    if (me.hp + me.healAbsorb - entryHit - chip - me.residual * turns > 1e-9) {
      return mon.species.name;
    }
  }
  return null;
}

/** Whether the foe's move acts before mine: Dex priority, then speed, a tie fails closed; no handler priorities. */
export function foeActsBefore(battle: Battle, foe: Pokemon, foeMoveId: string, mine: Pokemon, myMoveId: string): boolean {
  const foePriority = battle.dex.moves.getByID(foeMoveId as ID).priority;
  const myPriority = battle.dex.moves.getByID(myMoveId as ID).priority;
  if (foePriority !== myPriority) return foePriority > myPriority;
  const equalPriority = { priority: false };
  return movesFirst(foe, mine, equalPriority, equalPriority, battle) || !movesFirst(mine, foe, equalPriority, equalPriority, battle);
}

function nearDecidedFor(ctx: ProfileContext, key: 'p1' | 'p2', mine: Pokemon[], theirs: Pokemon[]): NearDecidedSweep | undefined {
  const attacker = mine.find(mon => mon.isActive);
  const target = theirs.find(mon => mon.isActive);
  if (!attacker || !target) return undefined;
  const foeKills = usableSlots(target).map(slot => ({ id: slot.id, pKill: boundaryEvent(ctx.battle, target, attacker, slot.id)?.pKill ?? 0 }));
  let odds = 0;
  let move = '';
  for (const slot of usableSlots(attacker)) {
    const event = boundaryEvent(ctx.battle, attacker, target, slot.id);
    if (!event) continue;
    const earlier = Math.max(0, ...foeKills.filter(kill => foeActsBefore(ctx.battle, target, kill.id, attacker, slot.id)).map(kill => kill.pKill));
    const slotOdds = event.pKill * (1 - earlier);
    if (slotOdds > odds) [odds, move] = [slotOdds, slot.id];
  }
  if (odds < NEAR_DECIDED_ODDS) return undefined;
  const rest = theirs.filter(enemy => enemy !== target);
  if (rest.length > 0 && !sweepSurvivor(ctx, [attacker], rest)) return undefined;
  const click = ctx.battle.gameType === 'doubles' ? { move, target: target.position + 1 } : { move };
  return { side: key, species: attacker.species.name, odds, removes: target.species.name, click };
}

function nearStage(
  ctx: ProfileContext,
  decided: DecidedSweep | undefined,
  p1Living: Pokemon[],
  p2Living: Pokemon[],
): NearDecidedSweep | undefined {
  if (decided) return undefined;
  const p1Near = nearDecidedFor(ctx, 'p1', p1Living, p2Living);
  const p2Near = nearDecidedFor(ctx, 'p2', p2Living, p1Living);
  if (p1Near && p2Near) return undefined;
  return p1Near ?? p2Near;
}

const FIRST_TURN_FLINCH_MOVES = new Set(['fakeout']);

const NEAR_DECIDED_ODDS = 0.9;

const DECIDED_MAX_TURNS = 6;

/** Living mons the other side has no live answer to; a narrative input, never part of the score. */
export function unansweredMons(battle: Battle, cache?: MatchupCache): UnansweredProfile {
  const p1Living = livingMons(battle, 0);
  const p2Living = livingMons(battle, 1);
  if (p1Living.length === 0 || p2Living.length === 0) return { p1: [], p2: [] };

  const ctx: ProfileContext = { battle, threat: threatGetter(battle, cache), profiles: new Map(), budgets: new Map() };
  const p1Profile = sideProfile(ctx, p1Living, p2Living);
  const p2Profile = sideProfile(ctx, p2Living, p1Living);
  const p1Sweep = sweepSurvivor(ctx, p1Living, p2Living);
  const p2Sweep = sweepSurvivor(ctx, p2Living, p1Living);
  const decided: DecidedSweep | undefined = p1Sweep !== null && p2Sweep === null
    ? { side: 'p1', species: p1Sweep }
    : p2Sweep !== null && p1Sweep === null
      ? { side: 'p2', species: p2Sweep }
      : undefined;
  const nearDecided = nearStage(ctx, decided, p1Living, p2Living);
  return {
    p1: p1Profile.full, p2: p2Profile.full,
    ...(p1Profile.entry.length > 0 ? { p1Entry: p1Profile.entry } : {}),
    ...(p2Profile.entry.length > 0 ? { p2Entry: p2Profile.entry } : {}),
    ...(decided ? { decided } : {}),
    ...(nearDecided ? { nearDecided } : {}),
  };
}
