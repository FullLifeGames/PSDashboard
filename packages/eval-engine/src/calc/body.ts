import { Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import { Dex, toID, type Battle, type Pokemon } from '@pkmn/sim';
import { buildCalcPokemon, calcGenerationFor, calcSpecies as sharedCalcSpecies, speciesOverrides as sharedSpeciesOverrides, simGenNum, CHAMPIONS_MOD, type CalcGeneration } from '@fulllifegames/replay-core';
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
  /** The stat a Paradox ability's volatile raises (T76). */
  boostedStat?: string;
  /** Supreme Overlord's fallen (T76). */
  alliesFainted?: number;
  /** The side's fallen, for Last Respects (T76). */
  totalFainted?: number;
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

type SimFacts = Pick<CalcBody, 'boostedStat' | 'alliesFainted' | 'totalFainted' | 'hpType' | 'hpPower'>;

/**
 * What the simulator holds and calc 0.11 cannot see on its own (round 67,
 * T76), read off the body and nothing derived from weather, terrain or item:
 * the stat the volatile of its ability names (Protosynthesis and Quark Drive
 * keep their bestStat there), the fallen its ability state counts (Supreme
 * Overlord), the side's fallen (Last Respects). A suppressed ability gives
 * neither of the first two, as in the simulator's own handlers. With them
 * Hidden Power's type and power (T83).
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
    hpType: mon.hpType,
    hpPower: mon.hpPower,
  };
}

export function bodyOf(battle: Battle, mon: Pokemon): SimBody {
  return {
    ...simBodyFacts(mon),
    species: mon.species.name,
    level: mon.level,
    ability: mon.ability ? battle.dex.abilities.get(mon.ability).name : '',
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
    try {
      const calcGen = calcGenerationFor(gen);
      const species = [...calcGen.species][0].name;
      const move = [...calcGen.moves].find(candidate => candidate.basePower > 0)!.name;
      const user = new CalcPokemon(calcGen, species, { ability: ability as never, ...(abilityOn ? { abilityOn: true } : {}) });
      const other = new CalcPokemon(calcGen, species, { ability: NO_ABILITY as never });
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
const NO_ABILITY = Dex.abilities.get('noability').name;

/**
 * The simulator's Dex behind a calculator generation: a game generation's own, and for the calculator's Champions
 * generation 0 the Champions mod's Dex where it is loaded (it loads with a Champions battle), else Gen 9's, whose
 * species data it shares (champions-vs-mod.md).
 */
export function simDexOf(gen: CalcGen): typeof Dex {
  const mod = (gen.num as number) === 0 ? Dex.dexes[CHAMPIONS_MOD] : undefined;
  return (mod ?? Dex.forGen(simGenNum(gen))) as typeof Dex;
}

/**
 * The species as the calc knows it (round 67, T72; replay-core calc-build.ts since round 68): the form the generation lists
 * with equal values, read against the simulator's Dex (the Champions mod's where it is loaded).
 */
export function calcSpecies(gen: number, name: string): string {
  return sharedCalcSpecies(gen, name, simDexOf(calcGenerationFor(gen)));
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
export function attackerAtUse<T extends CalcBody>(gen: number, body: T, moveName: string): T {
  const key = `${gen}|${body.species}|${body.ability}|${body.item}|${moveName}`;
  let atUse = atUseMemo.get(key);
  if (atUse === undefined) {
    atUse = { species: formeAtUse(gen, body, moveName), item: itemAtUse(gen, body.item, moveName) };
    atUseMemo.set(key, atUse);
  }
  return atUse.species === body.species && atUse.item === body.item ? body : { ...body, ...atUse };
}

function formeAtUse(gen: number, body: CalcBody, moveName: string): string {
  const dex = Dex.forGen(gen);
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
  return effective && calcAddsStages(gen.num, effective) ? NO_ABILITY : given;
}

/**
 * A body still to come in whose ability gives the holder a stage only with abilityOn (calcOwnEntryStage) gets abilityOn,
 * so the odds count the stage the simulator gives on entry once, as 0.11 did by itself. A body on the field never does.
 */
function entersWithStage(gen: CalcGen, body: CalcBody, ability: string | undefined, species: string): boolean {
  if (body.onField) return false;
  const effective = ability ?? gen.species.get(toID(species))?.abilities?.[0];
  return !!effective && calcOwnEntryStage((gen.num as number), effective);
}

/** The species as overrides, read from the simulator's Dex (replay-core calc-build.ts, decision 3). */
export function speciesOverrides(gen: CalcGen, name: string): ReturnType<typeof sharedSpeciesOverrides> {
  return sharedSpeciesOverrides(gen, name, simDexOf(gen));
}

/** The one place the engine builds a calc Pokémon (the species through replay-core's shared builder). */
export function calcPokemon(gen: CalcGen, body: CalcBody): CalcPokemon {
  const species = calcSpecies((gen.num as number), body.species);
  const ability = abilityForCalc(gen, body, species);
  return buildCalcPokemon(gen, body.species, {
    level: body.level,
    ability: ability as never,
    ...(entersWithStage(gen, body, ability, species) ? { abilityOn: true } : {}),
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
  }, simDexOf(gen));
}
