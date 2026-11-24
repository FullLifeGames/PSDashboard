import { OWN_RULES, type Own } from './move-use-rules.ts';


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
  species?: string;
  /** Candidate ability ids; the static passes its one. Empty: no ability rule applies. */
  abilities: readonly string[];
  item?: ItemLike | null;
  /** Tera type once clicked; null = not clicked. */
  terastallized?: string | null;
  types?: readonly string[];
  hpType?: string;
  hpPower?: number;
  /** Attack and Special Attack with their stages, unmodified (Tera Blast's category). */
  atk?: number;
  spa?: number;
  grounded?: boolean;
}

export interface MoveField { weather?: string; terrain?: string }
/** A move's type, category and base power at use; `powerMult` is the ability's power multiplier (1 when none). */
export interface MoveAtUse { type: string; category: string; basePower: number; powerMult: number }

// Special before the physical/special split (gens 1 to 3).
const SPECIAL_TYPES = new Set(['Fire', 'Water', 'Grass', 'Ice', 'Electric', 'Dark', 'Psychic', 'Dragon']);
const ATE: Record<string, string> = { pixilate: 'Fairy', aerilate: 'Flying', refrigerate: 'Ice', galvanize: 'Electric', dragonize: 'Dragon' };
/** The moves the -ate family leaves alone (abilities.js noModifyType). */
// oracle: packages/eval-engine/test/type-change-oracle.spec.ts
export const NO_ATE = new Set(['judgment', 'multiattack', 'naturalgift', 'revelationdance', 'technoblast', 'terrainpulse', 'weatherball']);
// oracle: packages/eval-engine/test/type-change-oracle.spec.ts
export const NO_NORMALIZE = new Set([...NO_ATE, 'hiddenpower', 'struggle']);

export const RULE_MOVES: ReadonlySet<string> = new Set(Object.keys(OWN_RULES));
export const RULE_ABILITIES: ReadonlySet<string> = new Set(['liquidvoice', 'normalize', ...Object.keys(ATE)]);
/** Moves whose answer reads a fact the matchup memo key lacks; pairKey appends it. */
// oracle: packages/eval-engine/test/type-change-oracle.spec.ts
export const CONTEXT_MOVES: ReadonlySet<string> = new Set<string>(['weatherball', 'terrainpulse', 'terablast', 'terastarstorm', 'hiddenpower']);

// Normalize: gens 3 and 4 turn every move but Struggle Normal; gens 5 and 6 those whose Dex type is not Normal
// (Hidden Power keeps its IV type); from gen 7 the NO_NORMALIZE moves stay and the rest turn Normal with a boost.
function withNormalize(move: MoveLike, own: MoveAtUse, user: MoveUser, teraBlastAfterClick: boolean): MoveAtUse {
  if (user.gen <= 4) return move.id === 'struggle' ? own : { ...own, type: 'Normal' };
  if (user.gen <= 6) return move.type === 'Normal' ? own : { ...own, type: 'Normal' };
  if (NO_NORMALIZE.has(move.id) || teraBlastAfterClick) return own;
  return { ...own, type: 'Normal', powerMult: own.powerMult * 4915 / 4096 };
}

function withAbility(ability: string, move: MoveLike, own: MoveAtUse, user: MoveUser): MoveAtUse {
  const teraBlastAfterClick = move.id === 'terablast' && !!user.terastallized;
  if (ability === 'liquidvoice') return move.flags.sound ? { ...own, type: 'Water' } : own;
  const ate = ATE[ability];
  if (ate) {
    if (own.type !== 'Normal' || NO_ATE.has(move.id) || teraBlastAfterClick) return own;
    return { ...own, type: ate, powerMult: own.powerMult * (user.gen === 6 ? 5325 : 4915) / 4096 };
  }
  return ability === 'normalize' ? withNormalize(move, own, user, teraBlastAfterClick) : own;
}

const same = (a: MoveAtUse, b: MoveAtUse) =>
  a.type === b.type && a.category === b.category && a.basePower === b.basePower && a.powerMult === b.powerMult;

// Raw facts only: the null-move sentence has no battle to ask and runs in the main bundle, so only rules are imported.
// The order is the simulator's (own rule, then ability; battle-actions.js useMoveInner); an unknown fact gives null.
export function moveAtUse(move: MoveLike, user: MoveUser, field: MoveField = {}): MoveAtUse | null {
  const rule = OWN_RULES[move.id];
  const own: Own = rule ? rule(move, user, field) : {};
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
