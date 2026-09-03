import type { Battle, Pokemon } from '@pkmn/sim';
import { boundaryEvent } from '../ko-odds.ts';
import { movesFirst } from '../speed.ts';
import { stageMultiplier } from '../stat-stages.ts';
import type { DecidedSweep, EntryUnanswered, NearDecidedSweep, UnansweredProfile } from '../types.ts';
import { hazardEntryFraction } from './hazards.ts';
import {
  livingMons, singleMoveFraction, threatGetter, usableSlots,
  type MatchupCache, type PairThreat, type ThreatGetter,
} from './threat.ts';
import { healProfile, ppBudget, raceClocks, statusResidual, type HealProfile, type RaceSide } from './races.ts';

/**
 * The root's unanswered-mon profile: mons no living enemy answers, the
 * switch-in stage, the decided sweep, and the near-decided roll. Narrative
 * input only — the score path never reads it.
 */

/** The memo state one unansweredMons call shares across its races. */
interface ProfileContext {
  battle: Battle;
  threat: ThreatGetter;
  profiles: Map<Pokemon, HealProfile>;
  budgets: Map<Pokemon, number>;
}

/**
 * Expected per-turn rate: the boost-adjusted fraction weighed by the
 * category-max move's accuracy (round 14) — the profile's races run on
 * what a turn is worth, not on the best case.
 */
function expectedRate(threatOut: PairThreat, attacker: Pokemon, defender: Pokemon): number {
  const physical = threatOut.physical * (threatOut.physicalAcc ?? 1) *
    stageMultiplier(attacker.boosts.atk) / stageMultiplier(defender.boosts.def);
  const special = threatOut.special * (threatOut.specialAcc ?? 1) *
    stageMultiplier(attacker.boosts.spa) / stageMultiplier(defender.boosts.spd);
  return Math.max(physical, special);
}

/** One mon's race side for the profile: entry-tolled HP off the bench, expected rates, memoized PP inputs. */
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

/**
 * The fresh entry's free chip: a usable first-turn flinch move lands once
 * before the standing defender gets a turn (its own accuracy is sure).
 */
function flinchChip(ctx: ProfileContext, standing: Pokemon, enemy: Pokemon): number {
  const slot = usableSlots(standing).find(entry => FIRST_TURN_FLINCH_MOVES.has(entry.id));
  if (!slot) return 0;
  return singleMoveFraction(standing, enemy, slot.id, ctx.battle) *
    stageMultiplier(standing.boosts.atk) / stageMultiplier(enemy.boosts.def);
}

/**
 * Does the standing mon beat this enemy? Race verdict as the matchup term
 * weighs it; a benched enemy eats one free hit on the way in, a standing
 * one loses its first turn to the entry's flinch move.
 */
function beatsEntry(ctx: ProfileContext, standing: Pokemon, enemy: Pokemon): boolean {
  const threatS = ctx.threat(standing, enemy);
  const threatE = ctx.threat(enemy, standing);
  const sideS = profileSide(ctx, standing, threatS, enemy);
  const sideE = profileSide(ctx, enemy, threatE, standing);
  if (!enemy.isActive) sideE.hp = Math.max(0, sideE.hp - expectedRate(threatS, standing, enemy));
  else sideE.hp = Math.max(0, sideE.hp - flinchChip(ctx, standing, enemy));
  const { turnsA, turnsB } = raceClocks(sideS, sideE);
  if (turnsA < turnsB) return true;
  if (turnsB < turnsA) return false;
  return turnsA !== Infinity && movesFirst(standing, enemy, threatS, threatE, ctx.battle);
}

/** The side's open (no live answer) list and its switch-in-stage rows. */
function sideProfile(ctx: ProfileContext, mine: Pokemon[], theirs: Pokemon[]): { full: string[]; entry: EntryUnanswered[] } {
  const full: string[] = [];
  const entry: EntryUnanswered[] = [];
  const hasBench = theirs.some(enemy => !enemy.isActive);
  for (const mon of mine) {
    const verdicts = theirs.map(enemy => ({ enemy, beats: beatsEntry(ctx, mon, enemy) }));
    if (verdicts.every(verdict => verdict.beats)) { full.push(mon.species.name); continue; }
    if (!hasBench) continue;
    // Switch-in stage: only standing actives hold; every bench answer
    // dies on arrival.
    if (!verdicts.every(verdict => verdict.beats || verdict.enemy.isActive)) continue;
    const holder = verdicts.find(verdict => !verdict.beats)!.enemy;
    entry.push({ species: mon.species.name, heldBy: holder.species.name });
  }
  return { full, entry };
}

/**
 * The sweeper's clean-up clock over every living enemy, with the spare-turn
 * return fire it absorbs on the way; blocked when it loses a pair.
 */
function sweepClocks(ctx: ProfileContext, mon: Pokemon, theirs: Pokemon[]): { turns: number; chip: number; blocked: boolean } {
  let turns = 0;
  let chip = 0;
  for (const enemy of theirs) {
    const threatS = ctx.threat(mon, enemy);
    const threatE = ctx.threat(enemy, mon);
    const first = movesFirst(mon, enemy, threatS, threatE, ctx.battle);
    const clocks = raceClocks(profileSide(ctx, mon, threatS, enemy), profileSide(ctx, enemy, threatE, mon));
    // The sweeper must WIN every pair outright (the beatsEntry verdict,
    // sans entry toll — replacements arrive on a KO, not a switch): a
    // "survivor" that loses pairs but outlasts them on paper is an
    // artifact of the spare-turn economy, not a clean-up.
    const wins = clocks.turnsA < clocks.turnsB ||
      (clocks.turnsA === clocks.turnsB && clocks.turnsA !== Infinity && first);
    if (!wins) return { turns, chip, blocked: true };
    const hits = Math.max(0, clocks.turnsA - (first ? 1 : 0));
    turns += clocks.turnsA;
    chip += hits * clocks.effFracB;
  }
  return { turns, chip, blocked: false };
}

/**
 * The decided sweep (round 15): pairwise unanswered is a threat; DECIDED
 * is stronger — one mon WINS every living enemy pair, clears the whole
 * team within a short clock (DECIDED_MAX_TURNS), and survives the
 * accumulated expected return fire (648453 t13: Lopunny wins every fresh
 * pair yet dies to the series; 573756 t134+: the last pair's one-sided
 * table is a decided endgame). Per pair the return fire is the
 * defender's spare-turn rate (raceClocks' action economy — a healer that
 * must heal to survive barely swings back). Replacements arrive
 * hazard-tolled but get no free hit (they enter on a KO, not a switch);
 * a benched sweeper pays its own entry: hazards plus one free expected
 * hit from the standing active.
 */
function sweepSurvivor(ctx: ProfileContext, mine: Pokemon[], theirs: Pokemon[]): string | null {
  const activeEnemy = theirs.find(enemy => enemy.isActive) ?? null;
  for (const mon of mine) {
    const { turns, chip, blocked } = sweepClocks(ctx, mon, theirs);
    if (blocked) continue;
    // "Practically decided" resolves NOW: a grind past the cap leaves the
    // opponent dozens of turns of play (573756 read decided from turn 1
    // without this).
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

/**
 * The near stage: no decided sweep stands, but one high-odds click
 * removes the standing active and the REST clears — the 573756 t73 shape
 * (a 95% Fire Fang from the sweep). Own active, own click — a teammate's
 * kill unlocking someone else's sweep stays out (narrower is honest).
 */
function nearDecidedFor(ctx: ProfileContext, key: 'p1' | 'p2', mine: Pokemon[], theirs: Pokemon[]): NearDecidedSweep | undefined {
  const attacker = mine.find(mon => mon.isActive);
  const target = theirs.find(mon => mon.isActive);
  if (!attacker || !target) return undefined;
  let odds = 0;
  for (const slot of usableSlots(attacker)) {
    const event = boundaryEvent(ctx.battle, attacker, target, slot.id);
    if (event && event.pKill > odds) odds = event.pKill;
  }
  if (odds < NEAR_DECIDED_ODDS) return undefined;
  const rest = theirs.filter(enemy => enemy !== target);
  const survivor = rest.length === 0 ? attacker.species.name : sweepSurvivor(ctx, mine, rest);
  if (!survivor) return undefined;
  return { side: key, species: survivor, odds, removes: target.species.name };
}

/** The near stage only while no decided sweep stands; both sides one roll away fails closed. */
function nearStage(
  ctx: ProfileContext,
  decided: DecidedSweep | undefined,
  p1Living: Pokemon[],
  p2Living: Pokemon[],
): NearDecidedSweep | undefined {
  if (decided) return undefined;
  const p1Near = nearDecidedFor(ctx, 'p1', p1Living, p2Living);
  const p2Near = nearDecidedFor(ctx, 'p2', p2Living, p1Living);
  if (p1Near && p2Near) return undefined; // both one roll away — fail closed
  return p1Near ?? p2Near;
}

/**
 * Moves that flinch-lock a full-hit answer on the user's first field turn:
 * the fresh entry the profile narrates gets one free chip the standing
 * defender cannot answer (648453 t13: Lopunny's Fake Out into Tornadus-T).
 */
const FIRST_TURN_FLINCH_MOVES = new Set(['fakeout']);

/**
 * Near-decided odds floor (round 15, user-gated): a click only counts as
 * "one roll from decided" when its boundary event (accuracy × kill share)
 * is at least this sure. The user's bar: a 95%-to-win click should read
 * that way — 0.9 keeps the stage to genuinely near-sure rolls (573756 t73
 * prices 0.95) and leaves coin flips out.
 */
const NEAR_DECIDED_ODDS = 0.9;

/**
 * Cap on the decided sweep's total clean-up clock (round 15). "Practically
 * decided" means the board resolves NOW, not eventually: the measured
 * anchors separate cleanly — real clean-up phases run 1–5 expected turns
 * (573756's locked endgame: 4; 648453's t23+ clean-up: 1–5), while the
 * false positives the uncapped check produced were 23–39-turn THEORETICAL
 * grinds (573756 read decided from turn 1 of a 139-turn game because the
 * whole enemy team priced as pinned healers). A slow grind leaves the
 * opponent dozens of turns of play — that is a threat, not a decided game.
 */
const DECIDED_MAX_TURNS = 6;

/**
 * Living mons the OTHER side has no live answer to (round 13): the mon
 * beats EVERY living enemy's KO-race pair (strictly fewer turns, or a
 * finite tie taken on effective speed — a wall that merely holds the pair
 * is answer enough). A benched enemy answers by SWITCHING IN, so its race
 * runs from entry-tolled HP: the hazard-adjusted arrival the matchup term
 * prices, minus one free hit from the standing mon (the switch-in economy
 * behind the expert's no-switch-ins principle — 648453 t13: Weavile "wins"
 * the standing pair against Lopunny but not the entry, so any successful
 * switch into Lopunny — a U-turn included — turns profit and the opponent
 * can only sacrifice into it). Root-level narrative input; never part of
 * the score.
 *
 * Round 14 refinements, all profile-local (the score path never changes):
 * - Rates are EXPECTED rates (fraction × the max-move's accuracy) — a 70%
 *   Hurricane is no full-hit one-turn clock. The entry toll weighs the
 *   same way.
 * - A first-turn flinch move (Fake Out) chips the standing active for free
 *   before the race starts — the fresh entry's move the defender cannot
 *   answer.
 * - The SWITCH-IN stage: a mon every benched enemy loses the entry race to
 *   while a standing active still holds the pair is carried per side in the
 *   entry lists — the expert's literal "no remaining switch-ins" state
 *   (648453 t13, Lopunny vs the standing Tornadus-T). Only meaningful while
 *   the other side still has a bench, so a 1v1 endgame never enters it.
 */
export function unansweredMons(battle: Battle, cache?: MatchupCache): UnansweredProfile {
  const p1Living = livingMons(battle, 0);
  const p2Living = livingMons(battle, 1);
  if (p1Living.length === 0 || p2Living.length === 0) return { p1: [], p2: [] };

  const ctx: ProfileContext = { battle, threat: threatGetter(battle, cache), profiles: new Map(), budgets: new Map() };
  const p1Profile = sideProfile(ctx, p1Living, p2Living);
  const p2Profile = sideProfile(ctx, p2Living, p1Living);
  const p1Sweep = sweepSurvivor(ctx, p1Living, p2Living);
  const p2Sweep = sweepSurvivor(ctx, p2Living, p1Living);
  // Fail closed: both sides sweeping (or neither) is not decided.
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
