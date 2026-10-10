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
  /** The stat a Paradox ability's volatile raises (T76). */
  boostedStat?: string;
  /** Supreme Overlord's fallen (T76). */
  alliesFainted?: number;
  /** The side's fallen, for Last Respects (T76). */
  totalFainted?: number;
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

type SimFacts = Pick<CalcBody, 'boostedStat' | 'alliesFainted' | 'totalFainted'>;

/**
 * What the simulator holds and calc 0.11 cannot see on its own (round 67,
 * T76), read off the body and nothing derived from weather, terrain or item:
 * the stat the volatile of its ability names (Protosynthesis and Quark Drive
 * keep their bestStat there), the fallen its ability state counts (Supreme
 * Overlord), the side's fallen (Last Respects). A suppressed ability gives
 * neither of the first two, as in the simulator's own handlers.
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

/** One answer per gen and name. */
const speciesMemo = new Map<string, string>();

/**
 * The species as the calc knows it (round 67, T72). The calc refuses a name
 * it does not list (Gastrodon-East, the simulator's "Aegislash" for the
 * Shield forme, color forms), so such a species goes to it as the form it
 * lists with the same base species in the Dex and the same base stats and
 * types: the base species' own name first, then the calc's order. Without
 * such a form the name stays, and the calc refuses as before.
 */
export function calcSpecies(gen: number, name: string): string {
  const key = `${gen}|${name}`;
  let known = speciesMemo.get(key);
  if (known === undefined) {
    known = knownForm(gen, name);
    speciesMemo.set(key, known);
  }
  return known;
}

function knownForm(gen: number, name: string): string {
  const calcGen = Generations.get(gen as 9);
  if (calcGen.species.get(toID(name))) return name;
  const dex = Dex.forGen(gen);
  const species = dex.species.get(name);
  if (!species.exists) return name;
  const stats = Object.values(species.baseStats).join('/');
  const types = species.types.join('/');
  const forms = [...calcGen.species].filter(form => dex.species.get(form.name).baseSpecies === species.baseSpecies &&
    Object.values(form.baseStats).join('/') === stats && form.types.join('/') === types);
  return (forms.find(form => form.name === species.baseSpecies) ?? forms[0])?.name ?? name;
}

/** One answer per gen, species, ability and move. */
const atUseMemo = new Map<string, string>();
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

/**
 * The attacker as its move finds it (round 67, T72): the forme its own
 * ability takes in the move's ModifyMove, asked from the Dex handler on a
 * stand-in that records the change, the way damage-calc asks its multi-hit
 * handlers. Stance Change turns Aegislash into Aegislash-Blade for every
 * attack, a rule the calc does not know. A handler that needs the battle
 * itself leaves the body as it is.
 */
export function attackerAtUse<T extends CalcBody>(gen: number, body: T, moveName: string): T {
  const key = `${gen}|${body.species}|${body.ability}|${moveName}`;
  let species = atUseMemo.get(key);
  if (species === undefined) {
    species = formeAtUse(gen, body, moveName);
    atUseMemo.set(key, species);
  }
  return species === body.species ? body : { ...body, species };
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

/** The one place the engine builds a calc Pokémon. */
export function calcPokemon(gen: CalcGen, body: CalcBody): CalcPokemon {
  const species = calcSpecies(gen.num, body.species);
  return new CalcPokemon(gen, species, {
    level: body.level,
    ability: abilityForCalc(gen, body, species) as never,
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
  });
}
