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

/** The root's unanswered-mon profile: mons no living enemy answers, the switch-in stage, the decided sweep and the near-decided roll. */

/** The memo state one unansweredMons call shares across its races. */
interface ProfileContext {
  battle: Battle;
  threat: ThreatGetter;
  profiles: Map<Pokemon, HealProfile>;
  budgets: Map<Pokemon, number>;
}

/** Per-turn expected damage fraction: the category-max move at its accuracy, each move on the stages of its own stats (PairThreat.axes). */
export function expectedRate(threatOut: PairThreat, attacker: Pokemon, defender: Pokemon): number {
  return expectedFraction(threatOut, attacker, defender);
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

/** The fresh entry's free chip: a usable first-turn flinch move lands once before the standing defender gets a turn. */
function flinchChip(ctx: ProfileContext, standing: Pokemon, enemy: Pokemon): number {
  const slot = usableSlots(standing).find(entry => FIRST_TURN_FLINCH_MOVES.has(entry.id));
  if (!slot) return 0;
  return singleMoveFraction(standing, enemy, slot.id, ctx.battle) *
    stageMultiplier(standing.boosts.atk) / stageMultiplier(enemy.boosts.def);
}

/**
 * Does the first mover take a finite tie (both clocks equal)? Only when its own hit finishes the last turn: a KO that needs the
 * foe's end-of-turn damage (burn, poison, Toxic) leaves the slower foe its action first, because the tick comes after both moves.
 * The foe's residual counts for the turns before the last, the first mover's own expected hit for the last.
 */
function firstTakesTie(sideA: RaceSide, sideB: RaceSide, clocks: RaceClocks, first: boolean): boolean {
  if (!first || clocks.turnsA === Infinity) return false;
  if (sideB.residual <= 0) return true;
  const incoming = sideA.frac + sideB.residual;
  const absorb = sideB.healRate > 0 && incoming > sideB.healRate ? sideB.healAbsorb * (sideB.healRate / incoming) : sideB.healAbsorb;
  const earlier = (clocks.turnsA - 1) * (clocks.effFracA + sideB.residual);
  return earlier + clocks.effFracA >= sideB.hp + absorb - 1e-9;
}

/** Does the standing mon beat this enemy? A benched enemy eats one free hit on the way in, a standing one loses its first turn to the entry's flinch move. */
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

/** The side's open (no live answer) list and its switch-in-stage rows. */
function sideProfile(ctx: ProfileContext, mine: Pokemon[], theirs: Pokemon[]): { full: string[]; entry: EntryUnanswered[] } {
  const full: string[] = [];
  const entry: EntryUnanswered[] = [];
  const hasBench = theirs.some(enemy => !enemy.isActive);
  for (const mon of mine) {
    const verdicts = theirs.map(enemy => ({ enemy, beats: beatsEntry(ctx, mon, enemy) }));
    if (verdicts.every(verdict => verdict.beats)) { full.push(mon.species.name); continue; }
    if (!hasBench) continue;
    // Switch-in stage: only standing actives hold; every bench answer dies on arrival.
    if (!verdicts.every(verdict => verdict.beats || verdict.enemy.isActive)) continue;
    const holder = verdicts.find(verdict => !verdict.beats)!.enemy;
    entry.push({ species: mon.species.name, heldBy: holder.species.name });
  }
  return { full, entry };
}

/** The sweeper's clean-up clock over every living enemy, with the spare-turn return fire it absorbs; blocked when it loses a pair. */
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
    // The sweeper must win every pair outright (the beatsEntry verdict without the entry toll, since replacements arrive on a KO):
    // a survivor that loses pairs but outlasts them on paper is an artifact of the spare-turn economy.
    const wins = clocks.turnsA < clocks.turnsB ||
      (clocks.turnsA === clocks.turnsB && firstTakesTie(sideS, sideE, clocks, first));
    if (!wins) return { turns, chip, blocked: true };
    const hits = Math.max(0, clocks.turnsA - (first ? 1 : 0));
    turns += clocks.turnsA;
    chip += hits * clocks.effFracB;
  }
  return { turns, chip, blocked: false };
}

/**
 * The decided sweep: one mon wins every living enemy pair, clears the whole team within DECIDED_MAX_TURNS and survives the
 * accumulated expected return fire (a Lopunny that wins every fresh pair yet dies to the series is no sweeper). Per pair the
 * return fire is the defender's spare-turn rate (a healer that must heal to survive barely swings back). Replacements arrive
 * hazard-tolled but get no free hit; a benched sweeper pays its own entry: hazards plus one free expected hit from the standing active.
 */
function sweepSurvivor(ctx: ProfileContext, mine: Pokemon[], theirs: Pokemon[]): string | null {
  const activeEnemy = theirs.find(enemy => enemy.isActive) ?? null;
  for (const mon of mine) {
    const { turns, chip, blocked } = sweepClocks(ctx, mon, theirs);
    if (blocked) continue;
    // A grind past the cap leaves the opponent dozens of turns of play: not decided.
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
 * Does the foe's move act before mine? Priority decides first, then the effective speed (inverted under Trick Room); an exact
 * speed tie is a coin flip in the simulator, so the foe may act first (the near stage fails closed). Dex priorities only: a
 * priority a handler moves (Prankster, Gale Wings, Triage, Grassy Glide in Grassy Terrain) is not read.
 */
export function foeActsBefore(battle: Battle, foe: Pokemon, foeMoveId: string, mine: Pokemon, myMoveId: string): boolean {
  const foePriority = battle.dex.moves.getByID(foeMoveId as ID).priority;
  const myPriority = battle.dex.moves.getByID(myMoveId as ID).priority;
  if (foePriority !== myPriority) return foePriority > myPriority;
  // movesFirst owns the speed order (Trick Room inverts it) and calls an exact tie first for neither side.
  const equalPriority = { priority: false };
  return movesFirst(foe, mine, equalPriority, equalPriority, battle) || !movesFirst(mine, foe, equalPriority, equalPriority, battle);
}

/**
 * The near stage: no decided sweep stands, but one high-odds click removes the standing active and the rest clears. Own active,
 * own click: the clicker itself clears the rest, a teammate's kill unlocking someone else's sweep stays out.
 */
function nearDecidedFor(ctx: ProfileContext, key: 'p1' | 'p2', mine: Pokemon[], theirs: Pokemon[]): NearDecidedSweep | undefined {
  const attacker = mine.find(mon => mon.isActive);
  const target = theirs.find(mon => mon.isActive);
  if (!attacker || !target) return undefined;
  // A click lands only if its user still acts: its odds are its kill chance times the chance the foe's best earlier kill does not come.
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
  // The click as the played choice writes it: a doubles move names the target's location.
  const click = ctx.battle.gameType === 'doubles' ? { move, target: target.position + 1 } : { move };
  return { side: key, species: attacker.species.name, odds, removes: target.species.name, click };
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
  if (p1Near && p2Near) return undefined; // both one roll away: fail closed
  return p1Near ?? p2Near;
}

/** Moves that flinch the target on the user's first field turn: the fresh entry gets one free chip (Lopunny's Fake Out into Tornadus-T). */
const FIRST_TURN_FLINCH_MOVES = new Set(['fakeout']);

/** Near-decided odds floor: a click counts as one roll from decided when its boundary event (accuracy x kill share) is at least this sure. */
const NEAR_DECIDED_ODDS = 0.9;

/** Cap on the decided sweep's total clean-up clock: real clean-up phases run 1 to 5 expected turns, a longer grind is a threat, not a decided game. */
const DECIDED_MAX_TURNS = 6;

/**
 * Living mons the other side has no live answer to: the mon beats every living enemy's KO-race pair (strictly fewer turns, or a
 * finite tie taken on effective speed). A benched enemy answers by switching in, so its race runs from entry-tolled HP (the
 * hazard-adjusted arrival, minus one free hit from the standing mon). The switch-in stage lists a mon every benched enemy loses
 * the entry race to while a standing active still holds the pair; it needs a bench on the other side, so a 1v1 endgame never
 * enters it. Narrative input, never part of the score.
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
