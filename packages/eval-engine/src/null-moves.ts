// Data-only Dex — this module is in the app's MAIN bundle; @pkmn/sim must
// never be imported here.
import { Dex } from '@pkmn/dex';
import { moveAtUse } from './move-use.ts';

/**
 * Mechanical-null detection for recommended moves (653785 t19: Will-O-Wisp
 * proposed into Charizard-X — Fire-types cannot be burned). The narrative
 * layer uses this to never render a provably useless recommendation
 * uncommented. CONSERVATIVE by design: only definite type-chart nulls fire.
 * Ability-granted immunities (Levitate, Flash Fire) stay out of scope, and
 * attacker abilities that BREAK an immunity (Scrappy, Corrosion) suppress
 * the verdict. It judges one comma-free move choice against one defender:
 * singles, and a doubles endgame with one living active per side (the single
 * target is then the single foe); a side with two acting slots carries a
 * comma and returns null. A terastallized defender is read by its Tera type
 * and named with it, so the sentence stays true of the body on the field.
 * Round 57: the type is the move's at use (move-use.ts): a move whose type
 * depends on a fact the sentence lacks, or on an ability the attacker may or
 * may not have, is no definite null.
 */

const STATUS_TEXT: Record<string, string> = {
  brn: 'burned',
  par: 'paralyzed',
  psn: 'poisoned',
  tox: 'badly poisoned',
  slp: 'put to sleep',
  frz: 'frozen',
};

type GenDex = ReturnType<typeof Dex.forGen>;
type DexMove = ReturnType<GenDex['moves']['get']>;

/**
 * Types immune to a major status, by generation. The @pkmn/dex type chart
 * only carries type-vs-type entries (no status keys), so this table is the
 * status half of the immunity check — curated to the unconditional rules.
 */
function statusImmuneTypes(status: string, gen: number): string[] {
  switch (status) {
    case 'brn': return ['Fire'];
    // Electric-types became paralysis-immune in gen 6.
    case 'par': return gen >= 6 ? ['Electric'] : [];
    // Steel gained its poison immunity with its introduction in gen 2.
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
 * The type the move lands with, from what the sentence knows (round 57):
 * the species, its possible abilities, the generation and the attacker's
 * Tera. An unknown item, weather, terrain or hidden type, or abilities that
 * disagree, leave it undecided (null) and the sentence silent.
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
  // The sim implements this one as onTryImmunity — no data field carries it.
  if (move.id === 'leechseed' && types.includes('Grass')) {
    return `Leech Seed cannot affect Grass-types like ${named}`;
  }
  return null;
}

/**
 * Why a single-slot move choice provably does nothing against the given
 * defender — or null when it might do something (which includes every case
 * where the data is incomplete: unknown move, unknown species, non-move or
 * doubles choice). `attackerSpecies` exists to SUPPRESS verdicts: when any
 * of the attacker's possible abilities breaks the immunity, the null is not
 * definite and the guard stays silent.
 */
export function nullMoveReason(params: {
  choice: string;
  gen: number;
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
  const dex = Dex.forGen(gen);
  const move = dex.moves.get(tokens[1]);
  if (!move.exists) return null;
  const defender = dex.species.get(params.defenderSpecies);
  if (!defender.exists) return null;
  const abilities = candidateAbilities(dex, params.attackerSpecies, tokens.includes('mega'));
  // A Tera click in this very choice lands before the move with a type the sentence does not know.
  const attackerTera = tokens.includes('terastallize') ? undefined : params.attackerTera;
  const type = typeAtUse(move, dex, gen, abilities, params.attackerSpecies, attackerTera);
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
