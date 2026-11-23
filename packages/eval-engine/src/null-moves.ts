import { rulesDex, type RulesDex, type RulesMod } from '@fulllifegames/replay-core';
import { moveAtUse } from './move-use.ts';

// Mechanical-null detection: names a recommended move that provably does nothing (Will-O-Wisp into Charizard-X: Fire-types cannot be burned).

const STATUS_TEXT: Record<string, string> = {
  brn: 'burned',
  par: 'paralyzed',
  psn: 'poisoned',
  tox: 'badly poisoned',
  slp: 'put to sleep',
  frz: 'frozen',
};

type GenDex = RulesDex;
type DexMove = ReturnType<GenDex['moves']['get']>;

/**
 * Types immune to a major status, by generation: the @pkmn/dex type chart has only type-vs-type entries, so this is the status half,
 * curated to the unconditional rules.
 */
function statusImmuneTypes(status: string, gen: number): string[] {
  switch (status) {
    case 'brn': return ['Fire'];
    // Electric-types are paralysis-immune from gen 6.
    case 'par': return gen >= 6 ? ['Electric'] : [];
    // Steel is poison-immune from gen 2, its first generation.
    case 'psn':
    case 'tox': return gen >= 2 ? ['Steel', 'Poison'] : ['Poison'];
    case 'frz': return ['Ice'];
    default: return [];
  }
}

const toAbilityId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The attacker's possible abilities (empty when the species is unknown); a
 * `mega` choice adds its Mega formes' (Mega evolution comes before moves).
 * They only ever SUPPRESS verdicts.
 */
function candidateAbilities(dex: GenDex, attackerSpecies: string | null, mega: boolean): string[] {
  const attacker = attackerSpecies ? dex.species.get(attackerSpecies) : null;
  if (!attacker?.exists) return [];
  const names = new Set(Object.values(attacker.abilities));
  if (mega) {
    for (const forme of attacker.otherFormes ?? []) {
      const species = dex.species.get(forme);
      if (species.exists && species.isMega) for (const name of Object.values(species.abilities)) names.add(name);
    }
  }
  return [...names];
}

/**
 * The type the move lands with, from what the sentence knows: the species, its possible abilities, the generation and the attacker's
 * Tera. An unknown item, weather, terrain or hidden type, or abilities that disagree, leave it undecided (null) and the sentence silent.
 */
function typeAtUse(
  move: DexMove,
  dex: GenDex,
  gen: number,
  abilityNames: readonly string[],
  attackerSpecies: string | null,
  attackerTera: string | null | undefined,
): string | null {
  const species = attackerSpecies ? dex.species.get(attackerSpecies) : null;
  const known = species?.exists ? species : null;
  const use = moveAtUse(move, {
    gen,
    species: known ? known.name : undefined,
    abilities: abilityNames.map(toAbilityId),
    terastallized: attackerTera,
    types: known ? known.types : undefined,
  });
  return use ? use.type : null;
}

/**
 * The move's type-chart immunity against the defender's types, and whether
 * an attacker ability the species may carry breaks it (Scrappy and gen 9's
 * Mind's Eye hit Ghosts with Normal/Fighting moves).
 */
function typeImmunityOf(
  dex: GenDex,
  move: DexMove,
  type: string,
  types: readonly string[],
  mayHave: (ability: string) => boolean,
): { typeImmune: boolean; immunityBroken: boolean } {
  const ignoreImmunity = move.ignoreImmunity === true ||
    (typeof move.ignoreImmunity === 'object' && move.ignoreImmunity !== null &&
      (move.ignoreImmunity as Record<string, boolean>)[type] === true);
  const typeImmune = !ignoreImmunity && !dex.getImmunity(type, types as never);
  const immunityBroken = (type === 'Normal' || type === 'Fighting') &&
    types.includes('Ghost') && (mayHave('Scrappy') || mayHave("Mind's Eye"));
  return { typeImmune, immunityBroken };
}

/** Why a status move provably does nothing: the status immunity, the move's own type immunity, powder, or Leech Seed. */
function statusNullReason(
  move: DexMove,
  type: string,
  named: string,
  types: readonly string[],
  gen: number,
  mayHave: (ability: string) => boolean,
  immunity: { typeImmune: boolean; immunityBroken: boolean },
): string | null {
  if (move.status) {
    const blocked = statusImmuneTypes(move.status, gen)
      .find(type => types.includes(type));
    const corroded = (move.status === 'psn' || move.status === 'tox') && mayHave('Corrosion');
    if (blocked && !corroded) {
      return `${named} cannot be ${STATUS_TEXT[move.status] ?? move.status} (${blocked}-type)`;
    }
    // Thunder Wave is the canonical status move WITHOUT ignoreImmunity: the
    // move's own type immunity applies (Ground blocks it).
    if (immunity.typeImmune && !immunity.immunityBroken) {
      return `${named} is immune to ${type}-type moves`;
    }
  }
  if (move.flags.powder && gen >= 6 && types.includes('Grass')) {
    return `powder moves do not affect Grass-types like ${named}`;
  }
  // The sim implements this one as onTryImmunity: no data field carries it.
  if (move.id === 'leechseed' && types.includes('Grass')) {
    return `Leech Seed cannot affect Grass-types like ${named}`;
  }
  return null;
}

/**
 * The attacker as the move meets it. A Tera click in this very choice lands
 * before the move, with a type and sometimes a forme (Terapagos-Stellar,
 * Ogerpon's Tera formes) the sentence does not know; an unknown attacker's
 * Tera is unknown too, whatever the caller passes (the app sends null for a
 * side without one active).
 */
function attackerAtUse(
  tokens: readonly string[],
  species: string | null,
  tera: string | null | undefined,
): { species: string | null; tera: string | null | undefined } {
  const clicking = tokens.includes('terastallize');
  return { species: clicking ? null : species, tera: clicking || !species ? undefined : tera };
}

/**
 * Why a single-slot move choice provably does nothing against the defender, or null when it might (unknown move or species, a
 * non-move choice, a comma choice with two acting slots: it judges singles and a doubles endgame with one living active per side). Only
 * definite type-chart and status nulls fire; ability-granted immunities (Levitate, Flash Fire) are out of scope. When any of the
 * attacker's possible abilities breaks the immunity (Scrappy, Corrosion), or the move's type depends on a fact the sentence lacks,
 * the null is not definite and the guard stays silent. A terastallized defender is read by its Tera type and named with it.
 */
export function nullMoveReason(params: {
  choice: string;
  gen: number;
  /** The replay's mod (Champions); absent for none. */
  mod?: RulesMod;
  attackerSpecies: string | null;
  defenderSpecies: string;
  /** The defender's Tera type when it has terastallized: it defends with that type (Stellar keeps the old ones). */
  defenderTera?: string | null;
  /** The attacker's Tera type when it has terastallized; undefined when unknown. */
  attackerTera?: string | null;
}): string | null {
  const tokens = params.choice.split(' ');
  if (tokens[0] !== 'move' || !tokens[1] || params.choice.includes(',')) return null;
  const gen = Math.min(9, Math.max(1, Math.round(params.gen)));
  const dex = rulesDex(gen, params.mod);
  const move = dex.moves.get(tokens[1]);
  if (!move.exists) return null;
  const defender = dex.species.get(params.defenderSpecies);
  if (!defender.exists) return null;
  const abilities = candidateAbilities(dex, params.attackerSpecies, tokens.includes('mega'));
  const attacker = attackerAtUse(tokens, params.attackerSpecies, params.attackerTera);
  const type = typeAtUse(move, dex, gen, abilities, attacker.species, attacker.tera);
  if (type === null) return null;
  const tera = params.defenderTera;
  const live = !!tera && tera !== 'Stellar';
  const types = live ? [tera] : defender.types;
  const named = live ? `${defender.name} (Tera ${tera})` : defender.name;
  const mayHave = (ability: string) => abilities.includes(ability);
  const immunity = typeImmunityOf(dex, move, type, types, mayHave);
  if (move.category !== 'Status') {
    return immunity.typeImmune && !immunity.immunityBroken ? `${named} is immune to ${type}-type moves` : null;
  }
  return statusNullReason(move, type, named, types, gen, mayHave, immunity);
}
