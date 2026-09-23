import { OWN_RULES, type Own } from './move-use-rules.ts';

/**
 * A move as it lands (round 57, T73 and T81). The dex carries a move's
 * catalog type, category and power; the simulator changes them at use:
 * abilities (Liquid Voice, the -ate family, Normalize), the user's forme
 * (Ivy Cudgel), a held plate, the weather, the terrain, the Tera click,
 * Hidden Power's type, weight, HP, speed and happiness. This table answers
 * from raw facts, in the simulator's order (the move's own rule, then the
 * ability; battle-actions.js useMoveInner), without asking the simulator:
 * on the bench the simulator switches abilities and items off, and in a
 * debug-mode format every suppressed handler writes a log line.
 *
 * NO IMPORTS beyond the rules: the null-move sentence runs in the app's main
 * bundle. A fact left undefined is unknown: a TYPE rule that needs it answers
 * null (the type is undecided), a POWER rule keeps the catalog power (the
 * static always passes its facts; the sentence reads only the type).
 */
export interface MoveLike {
  id: string;
  type: string;
  category: string;
  basePower: number;
  flags: { readonly sound?: number };
}

export interface ItemLike {
  id: string;
  onPlate?: string;
  onMemory?: string;
  onDrive?: string;
  naturalGift?: { basePower: number; type: string };
}

export interface MoveUser {
  gen: number;
  /** Species name ('Ogerpon-Wellspring-Tera'). */
  species?: string;
  /** Candidate ability ids; the static passes its one. Empty: no ability rule applies. */
  abilities: readonly string[];
  /** Held item data; null = none. */
  item?: ItemLike | null;
  /** Tera type once clicked; null = not clicked. */
  terastallized?: string | null;
  /** The body's own types. */
  types?: readonly string[];
  hpType?: string;
  hpPower?: number;
  happiness?: number;
  hp?: number;
  maxhp?: number;
  /** Weight in hectograms after Autotomize, Heavy Metal, Light Metal and Float Stone. */
  weighthg?: number;
  /** Speed with its stage, Choice Scarf, Iron Ball, paralysis and Tailwind. */
  speed?: number;
  /** Attack and Special Attack with their stages, unmodified (Tera Blast's category). */
  atk?: number;
  spa?: number;
  grounded?: boolean;
}

export interface MoveTarget { weighthg?: number; hp?: number; maxhp?: number; speed?: number }
export interface MoveField { weather?: string; terrain?: string }
export interface MoveAtUse { type: string; category: string; basePower: number; powerMult: number }

/** Types that were special before the physical/special split (gens 1 to 3). */
const SPECIAL_TYPES = new Set(['Fire', 'Water', 'Grass', 'Ice', 'Electric', 'Dark', 'Psychic', 'Dragon']);
const ATE: Record<string, string> = { pixilate: 'Fairy', aerilate: 'Flying', refrigerate: 'Ice', galvanize: 'Electric', dragonize: 'Dragon' };
/** Moves the -ate family leaves alone (abilities.js noModifyType); Normalize adds Hidden Power and Struggle. */
const NO_ATE = new Set(['judgment', 'multiattack', 'naturalgift', 'revelationdance', 'technoblast', 'terrainpulse', 'weatherball']);
const NO_NORMALIZE = new Set([...NO_ATE, 'hiddenpower', 'struggle']);

export const RULE_MOVES: ReadonlySet<string> = new Set(Object.keys(OWN_RULES));
export const RULE_ABILITIES: ReadonlySet<string> = new Set(['liquidvoice', 'normalize', ...Object.keys(ATE)]);
/**
 * Moves whose answer reads a fact the matchup memo's key does not carry
 * (weather, terrain, grounding, stages, HP, speed, weight, Hidden Power,
 * happiness): pairKey appends their answer (round 57).
 */
export const CONTEXT_MOVES: ReadonlySet<string> = new Set<string>(['weatherball', 'terrainpulse', 'terablast', 'terastarstorm', 'hiddenpower']);

function withAbility(ability: string, move: MoveLike, own: MoveAtUse, user: MoveUser): MoveAtUse {
  const teraBlastAfterClick = move.id === 'terablast' && !!user.terastallized;
  if (ability === 'liquidvoice') return move.flags.sound ? { ...own, type: 'Water' } : own;
  const ate = ATE[ability];
  if (ate) {
    if (own.type !== 'Normal' || NO_ATE.has(move.id) || teraBlastAfterClick) return own;
    return { ...own, type: ate, powerMult: own.powerMult * (user.gen === 6 ? 5325 : 4915) / 4096 };
  }
  if (ability !== 'normalize') return own;
  if (user.gen <= 6) return move.id === 'struggle' ? own : { ...own, type: 'Normal' };
  if (NO_NORMALIZE.has(move.id) || teraBlastAfterClick) return own;
  return { ...own, type: 'Normal', powerMult: own.powerMult * 4915 / 4096 };
}

const same = (a: MoveAtUse, b: MoveAtUse) =>
  a.type === b.type && a.category === b.category && a.basePower === b.basePower && a.powerMult === b.powerMult;

export function moveAtUse(move: MoveLike, user: MoveUser, field: MoveField = {}, target: MoveTarget = {}): MoveAtUse | null {
  const rule = OWN_RULES[move.id];
  const own: Own = rule ? rule(move, user, field, target) : {};
  if (own === null) return null;
  const base: MoveAtUse = {
    type: own.type ?? move.type,
    category: own.category ?? move.category,
    basePower: own.basePower ?? move.basePower,
    powerMult: 1,
  };
  // Before the split the type decides the category (mods/gen3: Hidden Power, Weather Ball).
  if (user.gen <= 3 && base.type !== move.type && own.category === undefined) {
    base.category = SPECIAL_TYPES.has(base.type) ? 'Special' : 'Physical';
  }
  if (user.abilities.length === 0) return base;
  const answers = user.abilities.map(ability => withAbility(ability, move, base, user));
  return answers.every(answer => same(answer, answers[0])) ? answers[0] : null;
}
