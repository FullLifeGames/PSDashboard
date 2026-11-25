import { Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import { toID, type Battle, type Pokemon } from '@pkmn/sim';
import { buildCalcPokemon, calcGenerationFor, calcSpecies as sharedCalcSpecies, dexOfCalc, rulesDex, type CalcGeneration, type RulesDex } from '@fulllifegames/replay-core';
import type { SimPokemonInfo } from '../branch/types.ts';
import { itemAtUse } from './typeless.ts';


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
  mod?: string;
  /** Only bodyOf sets it; undefined keeps the stage (false: spent before, or under a Neutralizing Gas). */
  entryStage?: boolean;
  /** Only on a body a Tera click makes that clears a weather or terrain (Teraform Zero); never on the field. */
  abilityOn?: boolean;
  /** The types already spent on the one-time Stellar boost (stellarBoostedTypes); absent when unknown. */
  stellarBoostedTypes?: string[];
  boostedStat?: string;
  alliesFainted?: number;
  totalFainted?: number;
  timesAttacked?: number;
  hpType?: string;
  hpPower?: number;
}

export interface SimBody extends CalcBody {
  abilityId: string;
  itemId: string;
  hp: number;
  maxhp: number;
  status: string;
}

type SimFacts = Pick<CalcBody, 'boostedStat' | 'alliesFainted' | 'totalFainted' | 'timesAttacked' | 'hpType' | 'hpPower' | 'stellarBoostedTypes'>;

/** A suppressed ability gives no bestStat and no fallen count, as in the simulator's own handlers. */
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

/** A benched body is asked as if on the field: the simulator's answer for a benched body is always yes (Gen 5+). */
export function abilitySuppressed(mon: Pokemon): boolean {
  if (mon.isActive) return mon.ignoringAbility();
  try {
    return (Object.create(mon, { isActive: { value: true } }) as Pokemon).ignoringAbility();
  } catch {
    return false;
  }
}

type StartHandler = (this: unknown, pokemon: unknown) => void;

// Gen 9 Intrepid Sword and Dauntless Shield return early once swordBoost or shieldBoost is set; Gen 8's never do.
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

const stageProbeMemo = new Map<string, boolean>();

const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;

function probeStages(gen: number, ability: string, abilityOn: boolean): boolean {
  const key = `${gen}|${ability}|${abilityOn}`;
  let moved = stageProbeMemo.get(key);
  if (moved === undefined) {
    moved = false;
    // Outside the try: a Champions generation without its mod throws; a failed read is never memoized as "no stage".
    const noAbility = noAbilityOf(rulesDex(gen));
    try {
      const calcGen = calcGenerationFor(gen);
      const species = [...calcGen.species][0].name;
      const move = [...calcGen.moves].find(candidate => candidate.basePower > 0)!.name;
      const user = new CalcPokemon(calcGen, species, { ability: ability as never, ...(abilityOn ? { abilityOn: true } : {}) });
      const other = new CalcPokemon(calcGen, species, { ability: noAbility as never });
      const result = calculate(calcGen, user, other, new CalcMove(calcGen, move), new Field({}));
      const changed = (stages: Partial<Stages>) => STAT_KEYS.some(stat => (stages[stat] ?? 0) !== 0);
      // With abilityOn only the holder's own stage counts: Intimidate's stage on the other side is the simulator's.
      moved = changed(result.attacker.boosts) || (!abilityOn && changed(result.defender.boosts));
    } catch {
      // An ability this gen's calc does not know adds nothing.
    }
    stageProbeMemo.set(key, moved);
  }
  return moved;
}

/** The calc adds a stage for Download (gen 4), Dauntless Shield and Intrepid Sword (gen 8), Embody Aspects (gen 9). */
export function calcAddsStages(gen: number, ability: string): boolean {
  return probeStages(gen, ability, false);
}

export function calcOwnEntryStage(gen: number, ability: string): boolean {
  return probeStages(gen, ability, true) && !probeStages(gen, ability, false);
}

// The calc takes the species' first ability unless given the simulator's own "No Ability".
const noAbilityOf = (dex: RulesDex): string => dex.abilities.get('noability').name;

/** The calc's species name, read against the simulator's Dex; generation 0 (Champions mod) throws unregistered. */
export function calcSpecies(gen: number, name: string): string {
  return sharedCalcSpecies(gen, name, dexOfCalc(calcGenerationFor(gen)));
}

const atUseMemo = new Map<string, { species: string; item: string }>();
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

/** The attacker as its move finds it: the forme its ModifyMove gives (Stance Change) and typeless.ts's item. */
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

// Entry boosts count once: a body on the field holds its stage already, so the calc gets "No Ability" for it.
function abilityForCalc(gen: CalcGen, body: CalcBody, species: string): string | undefined {
  const given = body.ability || undefined;
  if (!body.onField) return given;
  const effective = given ?? gen.species.get(toID(species))?.abilities?.[0];
  return effective && calcAddsStages(gen.num, effective) ? noAbilityOf(dexOfCalc(gen)) : given;
}

function entersWithStage(gen: CalcGen, body: CalcBody, ability: string | undefined, species: string): boolean {
  if (body.onField || body.entryStage === false) return false;
  const effective = ability ?? gen.species.get(toID(species))?.abilities?.[0];
  return !!effective && calcOwnEntryStage((gen.num as number), effective);
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
