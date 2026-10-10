import { Generations, Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import { Dex, toID, type Battle, type Pokemon } from '@pkmn/sim';
import type { SimPokemonInfo } from '../branch/types.ts';

/**
 * Round 67 (T100): one builder from the simulator to @smogon/calc. Every calc
 * Pokémon the engine prices (ko-odds.ts, damage-calc.ts, pair/kill-table.ts,
 * choice-lock.ts) is built by calcPokemon from a CalcBody: plain data read
 * off the simulator's body (bodyOf), off the picker's SimPokemonInfo
 * (bodyFromInfo) or off a built set (choice-lock.ts).
 */

type CalcGen = ReturnType<typeof Generations.get>;
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
  /** The battle's mod (Dex.currentMod), for a branch by format at the one place below. */
  mod?: string;
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

export function bodyOf(battle: Battle, mon: Pokemon): SimBody {
  return {
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
  };
}

/** One answer per gen and ability: does the calc change a stage by itself for it (Mew against Mew, the result's stages)? */
const addsStagesMemo = new Map<string, boolean>();

/**
 * The calc adds a stage of its own for a few abilities (round 67, read from
 * the calc: Download from gen 4, Dauntless Shield and Intrepid Sword from gen
 * 8, the Embody Aspects in gen 9; test/calc-entry-boost.spec.ts lists them).
 * One calculation per gen and ability tells: the stages of its result.
 */
export function calcAddsStages(gen: number, ability: string): boolean {
  const key = `${gen}|${ability}`;
  let adds = addsStagesMemo.get(key);
  if (adds === undefined) {
    adds = false;
    try {
      const calcGen = Generations.get(gen as 9);
      const user = new CalcPokemon(calcGen, 'Mew', { ability: ability as never });
      const other = new CalcPokemon(calcGen, 'Mew', { ability: NO_ABILITY as never });
      const result = calculate(calcGen, user, other, new CalcMove(calcGen, 'Tackle'), new Field({}));
      const moved = (stages: Partial<Stages>) => (['atk', 'def', 'spa', 'spd', 'spe'] as const).some(stat => (stages[stat] ?? 0) !== 0);
      adds = moved(result.attacker.boosts) || moved(result.defender.boosts);
    } catch {
      // An ability this gen's calc does not know adds nothing.
    }
    addsStagesMemo.set(key, adds);
  }
  return adds;
}

/** The simulator's own name for no ability: no check of the calc names it, and it keeps the calc off the species' first ability. */
const NO_ABILITY = Dex.abilities.get('noability').name;

/**
 * Entry boosts count once (T100). A body on the field holds its entry stage
 * already (the simulator applied it when the body came in, or it was spent
 * before), so an ability the calc would boost by itself, given or the calc's
 * default for the species, goes to the calc as "No Ability". A body still to
 * come in keeps it: the simulator boosts it on entry.
 */
function abilityForCalc(gen: CalcGen, body: CalcBody): string | undefined {
  const given = body.ability || undefined;
  if (!body.onField) return given;
  const effective = given ?? gen.species.get(toID(body.species))?.abilities?.[0];
  return effective && calcAddsStages(gen.num, effective) ? NO_ABILITY : given;
}

/** The one place the engine builds a calc Pokémon. */
export function calcPokemon(gen: CalcGen, body: CalcBody): CalcPokemon {
  return new CalcPokemon(gen, body.species, {
    level: body.level,
    ability: abilityForCalc(gen, body) as never,
    item: (body.item || undefined) as never,
    nature: (body.nature || undefined) as never,
    evs: body.evs,
    ivs: body.ivs,
    gender: (body.gender || undefined) as never,
    boosts: body.boosts,
    curHP: body.hp,
    status: (body.status || undefined) as never,
    teraType: (body.tera ?? undefined) as never,
  });
}
