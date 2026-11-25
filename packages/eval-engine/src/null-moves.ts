import { rulesDex, type RulesDex, type RulesMod } from '@fulllifegames/replay-core';
import { moveAtUse } from './move-use.ts';


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

// The type chart has only type-vs-type entries; this is the status half, curated to the unconditional rules.
function statusImmuneTypes(status: string, gen: number): string[] {
  switch (status) {
    case 'brn': return ['Fire'];
    case 'par': return gen >= 6 ? ['Electric'] : [];
    case 'psn':
    case 'tox': return gen >= 2 ? ['Steel', 'Poison'] : ['Poison'];
    case 'frz': return ['Ice'];
    default: return [];
  }
}

const toAbilityId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// A `mega` choice adds its Mega formes' abilities (Mega evolution comes before moves); they only SUPPRESS verdicts.
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

// An ability the attacker may carry can break it (Scrappy and gen 9's Mind's Eye hit Ghosts with Normal or Fighting).
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
    // Thunder Wave has no ignoreImmunity: its own type immunity applies (Ground blocks it).
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

// A Tera click in this choice lands before the move, with a type and sometimes a forme the sentence does not know;
// attacker's Tera is unknown too, whatever the caller passes (the app sends null for a side without one active).
function attackerAtUse(
  tokens: readonly string[],
  species: string | null,
  tera: string | null | undefined,
): { species: string | null; tera: string | null | undefined } {
  const clicking = tokens.includes('terastallize');
  return { species: clicking ? null : species, tera: clicking || !species ? undefined : tera };
}

/** Why a single-slot move choice provably does nothing against the defender; null when it might. Definite only. */
// Out of scope: ability immunities (Levitate, Flash Fire); judges singles and a doubles endgame with one active a side.
export function nullMoveReason(params: {
  choice: string;
  gen: number;
  mod?: RulesMod;
  attackerSpecies: string | null;
  defenderSpecies: string;
  /** Set once terastallized: it defends with that type (Stellar keeps the old ones). */
  defenderTera?: string | null;
  /** Set once terastallized; undefined when unknown. */
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
