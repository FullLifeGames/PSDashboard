// Data-only Dex — this module is in the app's MAIN bundle; @pkmn/sim must
// never be imported here.
import { Dex } from '@pkmn/dex';

/**
 * Mechanical-null detection for recommended moves (653785 t19: Will-O-Wisp
 * proposed into Charizard-X — Fire-types cannot be burned). The narrative
 * layer uses this to never render a provably useless recommendation
 * uncommented. CONSERVATIVE by design: only definite type-chart nulls fire.
 * Ability-granted immunities (Levitate, Flash Fire) stay out of scope, and
 * attacker abilities that BREAK an immunity (Scrappy, Corrosion) suppress
 * the verdict. Singles only — doubles choices carry commas and return null.
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
type DexSpecies = ReturnType<GenDex['species']['get']>;

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

/** The attacker's possible abilities (empty when the species is unknown) — they only ever SUPPRESS verdicts. */
function attackerAbilities(dex: GenDex, attackerSpecies: string | null): string[] {
  const attacker = attackerSpecies ? dex.species.get(attackerSpecies) : null;
  return attacker?.exists ? Object.values(attacker.abilities) : [];
}

/**
 * The move's type-chart immunity against the defender's types, and whether
 * an attacker ability the species may carry breaks it (Scrappy and gen 9's
 * Mind's Eye hit Ghosts with Normal/Fighting moves).
 */
function typeImmunityOf(
  dex: GenDex,
  move: DexMove,
  types: readonly string[],
  mayHave: (ability: string) => boolean,
): { typeImmune: boolean; immunityBroken: boolean } {
  const ignoreImmunity = move.ignoreImmunity === true ||
    (typeof move.ignoreImmunity === 'object' && move.ignoreImmunity !== null &&
      (move.ignoreImmunity as Record<string, boolean>)[move.type] === true);
  const typeImmune = !ignoreImmunity && !dex.getImmunity(move.type, types as never);
  const immunityBroken = (move.type === 'Normal' || move.type === 'Fighting') &&
    types.includes('Ghost') && (mayHave('Scrappy') || mayHave("Mind's Eye"));
  return { typeImmune, immunityBroken };
}

/** Why a status move provably does nothing: the status immunity, the move's own type immunity, powder, or Leech Seed. */
function statusNullReason(
  move: DexMove,
  defender: DexSpecies,
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
      return `${defender.name} cannot be ${STATUS_TEXT[move.status] ?? move.status} (${blocked}-type)`;
    }
    // Thunder Wave is the canonical status move WITHOUT ignoreImmunity: the
    // move's own type immunity applies (Ground blocks it).
    if (immunity.typeImmune && !immunity.immunityBroken) {
      return `${defender.name} is immune to ${move.type}-type moves`;
    }
  }
  if (move.flags.powder && gen >= 6 && types.includes('Grass')) {
    return `powder moves do not affect Grass-types like ${defender.name}`;
  }
  // The sim implements this one as onTryImmunity — no data field carries it.
  if (move.id === 'leechseed' && types.includes('Grass')) {
    return `Leech Seed cannot affect Grass-types like ${defender.name}`;
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
}): string | null {
  const tokens = params.choice.split(' ');
  if (tokens[0] !== 'move' || !tokens[1] || params.choice.includes(',')) return null;
  const dex = Dex.forGen(Math.min(9, Math.max(1, Math.round(params.gen))));
  const move = dex.moves.get(tokens[1]);
  if (!move.exists) return null;
  const defender = dex.species.get(params.defenderSpecies);
  if (!defender.exists) return null;
  const types = defender.types;

  const abilities = attackerAbilities(dex, params.attackerSpecies);
  const mayHave = (ability: string) => abilities.includes(ability);
  const immunity = typeImmunityOf(dex, move, types, mayHave);

  if (move.category !== 'Status') {
    return immunity.typeImmune && !immunity.immunityBroken
      ? `${defender.name} is immune to ${move.type}-type moves`
      : null;
  }
  return statusNullReason(move, defender, types, params.gen, mayHave, immunity);
}
