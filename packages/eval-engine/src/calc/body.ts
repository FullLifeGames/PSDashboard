import { Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import { toID, type Battle, type Pokemon } from '@pkmn/sim';
import { buildCalcPokemon, calcGenerationFor, calcSpecies as sharedCalcSpecies, dexOfCalc, rulesDex, speciesOverrides as sharedSpeciesOverrides, type CalcGeneration, type RulesDex } from '@fulllifegames/replay-core';
import type { SimPokemonInfo } from '../branch/types.ts';
import { itemAtUse } from './typeless.ts';

/**
 * Round 67 (T100): one builder from the simulator to @smogon/calc. Every calc
 * Pokémon the engine prices (ko-odds.ts, damage-calc.ts, pair/kill-table.ts,
 * choice-lock.ts) is built by calcPokemon from a CalcBody: plain data read
 * off the simulator's body (bodyOf), off the picker's SimPokemonInfo
 * (bodyFromInfo) or off a built set (choice-lock.ts).
 */

type CalcGen = CalcGeneration;
type Stages = { atk: number; def: number; spa: number; spd: number; spe: number };
type StatSpread = Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;

export interface CalcBody {
  species: string;
  level: number;
  /** Calc (display) name; '' when unknown, and the calc takes the species' first. */
  ability: string;
  item: string;
  nature: string;
  evs: StatSpread;
  ivs: StatSpread;
  gender?: string;
  boosts: Stages;
  /** Current HP; without it the calc reads full HP. */
  hp?: number;
  status?: string;
  tera: string | null;
  /** The body stands on the field: its stages come from the simulator and already hold every entry boost. */
  onField: boolean;
  /** The battle's mod (Dex.currentMod), for the Champions mod's move overrides (calc/move.ts). */
  mod?: string;
  /**
   * A body still to come in: does the simulator give its ability's entry stage now (Intrepid Sword and Dauntless Shield
   * once per battle in Gen 9, none under a Neutralizing Gas)? Only bodyOf reads it off the simulator; a body from the
   * picker or a built set carries no simulator flags and leaves it undefined, which keeps the stage (T156).
   */
  entryStage?: boolean;
  /**
   * The calc's abilityOn for this body, set only on the body a Tera click makes when the click clears a weather or a
   * terrain that stands (Teraform Zero, T152; calc/tera-click.ts): the calc then clears its field too. A body on the
   * field never carries it, because the simulator cleared the field when it clicked.
   */
  abilityOn?: boolean;
  /** The types a Stellar body has spent its one-time boost on (the simulator's stellarBoostedTypes, T152); absent when unknown. */
  stellarBoostedTypes?: string[];
  /** The stat a Paradox ability's volatile raises (T76). */
  boostedStat?: string;
  /** Supreme Overlord's fallen (T76). */
  alliesFainted?: number;
  /** The side's fallen, for Last Respects (T76). */
  totalFainted?: number;
  /** The hits the body took (the simulator's timesAttacked), for Rage Fist (round 76, T265); absent when none or unknown. */
  timesAttacked?: number;
  /** Hidden Power's type and power as the simulator gives them (T83). */
  hpType?: string;
  hpPower?: number;
}

/** A body read off the simulator: everything the calc and the pair plan's guards read, as plain data. */
export interface SimBody extends CalcBody {
  /** The sim's ids next to the calc names. */
  abilityId: string;
  itemId: string;
  hp: number;
  maxhp: number;
  status: string;
}

type SimFacts = Pick<CalcBody, 'boostedStat' | 'alliesFainted' | 'totalFainted' | 'timesAttacked' | 'hpType' | 'hpPower' | 'stellarBoostedTypes'>;

/**
 * What the simulator holds and calc 0.11 cannot see on its own (round 67,
 * T76), read off the body and nothing derived from weather, terrain or item:
 * the stat the volatile of its ability names (Protosynthesis and Quark Drive
 * keep their bestStat there), the fallen its ability state counts (Supreme
 * Overlord), the side's fallen (Last Respects). A suppressed ability gives
 * neither of the first two, as in the simulator's own handlers. With them
 * Hidden Power's type and power (T83), and for a body of the Stellar Tera type
 * the types it has spent its one-time boost on (T152).
 */
export function simBodyFacts(mon: Pokemon): SimFacts {
  const active = !mon.ignoringAbility();
  const boostedStat = active ? (mon.volatiles[mon.ability] as { bestStat?: string } | undefined)?.bestStat : undefined;
  const alliesFainted = active ? (mon.abilityState as { fallen?: number }).fallen : undefined;
  const totalFainted = mon.side.totalFainted;
  return {
    ...(boostedStat ? { boostedStat } : {}),
    ...(alliesFainted ? { alliesFainted } : {}),
    ...(totalFainted ? { totalFainted } : {}),
    ...(mon.timesAttacked ? { timesAttacked: mon.timesAttacked } : {}),
    ...(mon.teraType === 'Stellar' || mon.terastallized === 'Stellar' ? { stellarBoostedTypes: [...mon.stellarBoostedTypes] } : {}),
    hpType: mon.hpType,
    hpPower: mon.hpPower,
  };
}

/**
 * Does the simulator suppress `mon`'s ability now (Gastro Acid, an active Neutralizing Gas: ignoringAbility)? A body on
 * the bench is asked as if it stood on the field, because the simulator's own answer for a benched body is always yes
 * (Gen 5 and later): the stand-in reads the body's own state and says what the entry would meet.
 */
export function abilitySuppressed(mon: Pokemon): boolean {
  if (mon.isActive) return mon.ignoringAbility();
  try {
    return (Object.create(mon, { isActive: { value: true } }) as Pokemon).ignoringAbility();
  } catch {
    return false;
  }
}

type StartHandler = (this: unknown, pokemon: unknown) => void;

/**
 * Does the simulator give the body, still to come in, the stage its ability gives on entry (T156)? The ability's own
 * onStart from the Dex, run on a stand-in that records the holder's boost, with the holder's flags copied from the real
 * Pokémon: the Gen 9 handlers of Intrepid Sword and Dauntless Shield return early once swordBoost or shieldBoost is
 * set, Gen 8's give the stage every time. Only for an ability whose stage the calc gives with abilityOn
 * (calcOwnEntryStage), the one place that needs the answer; undefined elsewhere, and for a body on the field.
 */
function entryStageOf(battle: Battle, mon: Pokemon, suppressed: boolean): boolean | undefined {
  if (mon.isActive || !mon.ability) return undefined;
  const ability = battle.dex.abilities.get(mon.ability);
  if (!calcOwnEntryStage(calcGenerationFor(battle.gen, battle.dex.currentMod).num as number, ability.name)) return undefined;
  const handler = (ability as { onStart?: unknown }).onStart;
  if (suppressed || typeof handler !== 'function') return false;
  const holder = { ...mon };
  let boosted = false;
  const field = { boost: (boost: Record<string, number>, target: unknown) => { boosted ||= target === holder && Object.values(boost).some(stage => stage !== 0); return true; } };
  try {
    (handler as StartHandler).call(field, holder);
  } catch {
    // A handler that needs the battle itself gives no stage.
  }
  return boosted;
}

export function bodyOf(battle: Battle, mon: Pokemon): SimBody {
  const suppressed = !!mon.ability && abilitySuppressed(mon);
  const entryStage = entryStageOf(battle, mon, suppressed);
  return {
    ...simBodyFacts(mon),
    ...(entryStage === undefined ? {} : { entryStage }),
    species: mon.species.name,
    level: mon.level,
    // A suppressed ability reaches the calc as No Ability: Multiscale under Gastro Acid is no Multiscale (abilityId stays the simulator's).
    ability: !mon.ability ? '' : suppressed ? noAbilityOf(battle.dex) : battle.dex.abilities.get(mon.ability).name,
    abilityId: mon.ability,
    item: mon.item ? battle.dex.items.get(mon.item).name : '',
    itemId: mon.item,
    nature: mon.set.nature ?? '',
    evs: { ...mon.set.evs },
    ivs: { ...mon.set.ivs },
    gender: mon.gender,
    boosts: { atk: mon.boosts.atk, def: mon.boosts.def, spa: mon.boosts.spa, spd: mon.boosts.spd, spe: mon.boosts.spe },
    hp: mon.hp,
    maxhp: mon.maxhp,
    status: mon.status,
    tera: mon.terastallized ?? null,
    onField: mon.isActive,
    mod: battle.dex.currentMod,
  };
}

/** A body read off the picker's state (the live branch or the snapshot picker). */
export function bodyFromInfo(info: SimPokemonInfo): SimBody {
  const stage = (stat: keyof Stages) => info.boosts[stat] ?? 0;
  return {
    species: info.species,
    level: info.level,
    ability: info.ability,
    abilityId: toID(info.ability),
    item: info.item,
    itemId: toID(info.item),
    nature: info.nature ?? '',
    evs: { ...info.evs },
    ivs: { ...info.ivs },
    gender: info.gender,
    boosts: { atk: stage('atk'), def: stage('def'), spa: stage('spa'), spd: stage('spd'), spe: stage('spe') },
    hp: info.hp,
    maxhp: info.maxhp,
    status: info.status,
    tera: info.teraType || null,
    onField: info.isActive,
    boostedStat: info.boostedStat,
    alliesFainted: info.alliesFainted,
    totalFainted: info.totalFainted,
    timesAttacked: info.timesAttacked,
    stellarBoostedTypes: info.stellarBoostedTypes,
    hpType: info.hpType,
    hpPower: info.hpPower,
    mod: info.mod,
  };
}

/** One answer per gen, ability and abilityOn: does the calc change a stage of either side for it? */
const stageProbeMemo = new Map<string, boolean>();

const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;

/**
 * One calculation tells whether the calc moves a stage for `ability` on a body of the generation's own first species
 * (round 68: the generation itself names the species, so generation 0, which lacks Mew, is probed like the others),
 * with `abilityOn` as given: the stages of its result.
 */
function probeStages(gen: number, ability: string, abilityOn: boolean): boolean {
  const key = `${gen}|${ability}|${abilityOn}`;
  let moved = stageProbeMemo.get(key);
  if (moved === undefined) {
    moved = false;
    // Outside the try: a Champions generation without its mod throws, and a failed read is never memoized as "no stage".
    const noAbility = noAbilityOf(rulesDex(gen));
    try {
      const calcGen = calcGenerationFor(gen);
      const species = [...calcGen.species][0].name;
      const move = [...calcGen.moves].find(candidate => candidate.basePower > 0)!.name;
      const user = new CalcPokemon(calcGen, species, { ability: ability as never, ...(abilityOn ? { abilityOn: true } : {}) });
      const other = new CalcPokemon(calcGen, species, { ability: noAbility as never });
      const result = calculate(calcGen, user, other, new CalcMove(calcGen, move), new Field({}));
      const changed = (stages: Partial<Stages>) => STAT_KEYS.some(stat => (stages[stat] ?? 0) !== 0);
      // With abilityOn only the holder's own stage counts: Intimidate moves the other side's stages, which the simulator gives too.
      moved = changed(result.attacker.boosts) || (!abilityOn && changed(result.defender.boosts));
    } catch {
      // An ability this gen's calc does not know adds nothing.
    }
    stageProbeMemo.set(key, moved);
  }
  return moved;
}

/**
 * The calc adds a stage of its own for a few abilities (round 67, read from
 * the calc: Download from gen 4, Dauntless Shield and Intrepid Sword in gen
 * 8, the Embody Aspects in gen 9; test/calc-entry-boost.spec.ts lists them).
 * One calculation per gen and ability tells: the stages of its result.
 */
export function calcAddsStages(gen: number, ability: string): boolean {
  return probeStages(gen, ability, false);
}

/**
 * The calc adds a stage to the holder only when its `abilityOn` is set (round 68, T186, decision 5: Intrepid Sword and
 * Dauntless Shield in Gen 9 under 0.12; 0.11 gave them by itself). Read from the calc the same way: a stage with
 * abilityOn and none without.
 */
export function calcOwnEntryStage(gen: number, ability: string): boolean {
  return probeStages(gen, ability, true) && !probeStages(gen, ability, false);
}

/** The simulator's own name for no ability: no check of the calc names it, and it keeps the calc off the species' first ability. */
const noAbilityOf = (dex: RulesDex): string => dex.abilities.get('noability').name;

/**
 * The species as the calc knows it (round 67, T72; replay-core calc-build.ts since round 68): the form the generation lists
 * with equal values, read against the simulator's Dex (round 75, T160: the generation's own, the Champions mod's for generation 0, which throws unregistered).
 */
export function calcSpecies(gen: number, name: string): string {
  return sharedCalcSpecies(gen, name, dexOfCalc(calcGenerationFor(gen)));
}

/** One answer per gen, species, ability, item and move. */
const atUseMemo = new Map<string, { species: string; item: string }>();
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

/**
 * The attacker as its move finds it (round 67, T72): the forme its own
 * ability takes in the move's ModifyMove, asked from the Dex handler on a
 * stand-in that records the change, the way damage-calc asks its multi-hit
 * handlers. Stance Change turns Aegislash into Aegislash-Blade for every
 * attack, a rule the calc does not know. A handler that needs the battle
 * itself leaves the body as it is. Round 68: the item as the move finds it
 * too (typeless.ts: a Normal-boost item on Struggle in Gens 2 to 4).
 */
export function attackerAtUse<T extends CalcBody>(dex: RulesDex, body: T, moveName: string): T {
  const key = `${dex.gen}|${dex.currentMod}|${body.species}|${body.ability}|${body.item}|${moveName}`;
  let atUse = atUseMemo.get(key);
  if (atUse === undefined) {
    atUse = { species: formeAtUse(dex, body, moveName), item: itemAtUse(dex, body.item, moveName) };
    atUseMemo.set(key, atUse);
  }
  return atUse.species === body.species && atUse.item === body.item ? body : { ...body, ...atUse };
}

function formeAtUse(dex: RulesDex, body: CalcBody, moveName: string): string {
  const handler = (dex.abilities.get(body.ability) as { onModifyMove?: unknown }).onModifyMove;
  if (typeof handler !== 'function' || !dex.moves.get(moveName).exists) return body.species;
  let forme = body.species;
  const user = { species: dex.species.get(body.species), transformed: false, formeChange: (id: string) => { forme = dex.species.get(id).name; } };
  try {
    (handler as ModifyMoveHandler).call(undefined, dex.getActiveMove(moveName), user, null);
  } catch {
    // The handler needs the battle itself: the body keeps its forme.
  }
  return forme;
}

/**
 * Entry boosts count once (T100). A body on the field holds its entry stage
 * already (the simulator applied it when the body came in, or it was spent
 * before), so an ability the calc would boost by itself, given or the calc's
 * default for the species, goes to the calc as "No Ability". A body still to
 * come in keeps it: the simulator boosts it on entry.
 */
function abilityForCalc(gen: CalcGen, body: CalcBody, species: string): string | undefined {
  const given = body.ability || undefined;
  if (!body.onField) return given;
  const effective = given ?? gen.species.get(toID(species))?.abilities?.[0];
  return effective && calcAddsStages(gen.num, effective) ? noAbilityOf(dexOfCalc(gen)) : given;
}

/**
 * A body still to come in whose ability gives the holder a stage only with abilityOn (calcOwnEntryStage) gets abilityOn,
 * so the odds count the stage the simulator gives on entry once, as 0.11 did by itself. A body on the field never does, and neither does one the
 * simulator gives no stage now (entryStage false: spent before, or entering under a Neutralizing Gas).
 */
function entersWithStage(gen: CalcGen, body: CalcBody, ability: string | undefined, species: string): boolean {
  if (body.onField || body.entryStage === false) return false;
  const effective = ability ?? gen.species.get(toID(species))?.abilities?.[0];
  return !!effective && calcOwnEntryStage((gen.num as number), effective);
}

/** The species as overrides, read from the simulator's Dex (replay-core calc-build.ts, decision 3). */
export function speciesOverrides(gen: CalcGen, name: string): ReturnType<typeof sharedSpeciesOverrides> {
  return sharedSpeciesOverrides(gen, name, dexOfCalc(gen));
}

/** The one place the engine builds a calc Pokémon (the species through replay-core's shared builder). */
export function calcPokemon(gen: CalcGen, body: CalcBody): CalcPokemon {
  const species = calcSpecies((gen.num as number), body.species);
  const ability = abilityForCalc(gen, body, species);
  return buildCalcPokemon(gen, body.species, {
    level: body.level,
    ability: ability as never,
    ...(body.abilityOn || entersWithStage(gen, body, ability, species) ? { abilityOn: true } : {}),
    item: (body.item || undefined) as never,
    nature: (body.nature || undefined) as never,
    evs: body.evs,
    ivs: body.ivs,
    gender: (body.gender || undefined) as never,
    boosts: body.boosts,
    curHP: body.hp,
    status: (body.status || undefined) as never,
    teraType: (body.tera ?? undefined) as never,
    boostedStat: body.boostedStat as never,
    alliesFainted: body.alliesFainted,
  }, dexOfCalc(gen));
}
