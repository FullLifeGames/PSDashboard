import { toId } from '@fulllifegames/replay-core';
import { dieKey, type ForcedDie } from './types.ts';

/**
 * Round 82 (forced dice), step A5, gate answer 19a: the dice a log shows, read per action. On the first turn of a branch the
 * chips show what the log rolled for each action the user leaves as logged; once the user forces any die in that turn the
 * module forces the other visible logged results too, so the turn differs from the log only in the user's die even where the
 * 16-seed search (arrival-dice.ts) found no perfect seed.
 *
 * PURE module, like `hax-alignment.ts`, whose lines it reads (the misses, crits, hit counts, `|cant|` reasons, status,
 * boost and volatile lines): type-only simulator imports, so the app may import it from the main bundle.
 * `dice-logged-results.spec.ts` holds the two readers to each other on every turn of the fixtures.
 *
 * A result the log does not show stays with the seed: the damage rolls, a flinch on a target that already moved, a check the
 * log cannot name (a body that stood under paralysis and moved shows no `|cant|`). The caller can name what the log cannot
 * (`LoggedOptions`): the moves each body clicked, the checks each body stood under, the secondaries each move can fire.
 */

export interface LoggedOptions {
  /** The move each body clicked, by slot: a `|cant|` line names no move, and a status check is named by the move in flight. */
  clicked?: ReadonlyMap<string, string>;
  /** The status-check conditions each body stood under at the start of the turn, by slot (`par`, `confusion`, `attract`, `frz`). */
  checks?: ReadonlyMap<string, readonly string[]>;
  /**
   * The effect ids (`secondaryEffectId`'s words: `brn`, `flinch`, `boosts:spd`, `self:atk+def`) of the entries of a move's
   * secondaries that carry a chance. With them a secondary the log shows nothing of is a logged no.
   */
  secondariesOf?: (moveId: string) => readonly string[];
}

/** One stretch of the log: a body's `|move|` or `|cant|` line and the lines up to the next action, or the lines between actions. */
export interface LoggedAction {
  type: 'move' | 'cant' | 'other';
  slot: string;
  ident: string;
  moveId: string;
  /** The reason of a `|cant|` line as an id (`par`, `flinch`, `slp`). */
  reason: string;
  /** The ident of each slot the block names. */
  idents: Record<string, string>;
  /** The slots the move was aimed at or hit, the aimed one first. */
  targets: string[];
  missed: string[];
  /** The `[miss]` marks and `|-miss|` lines of the block, as the alignment reader counts them. */
  misses: number;
  /** The damage lines (no `[from]`) per slot. */
  damaged: Record<string, number>;
  crits: Record<string, number>;
  hitCounts: Record<string, number>;
  /** The damage lines of the confusion self-hit per slot, and the condition id the line names. */
  selfHits: Record<string, number>;
  selfHitBy: Record<string, string>;
  /** The status and volatile ids the move left on a slot (no `[from]`). */
  effects: Record<string, string[]>;
  /** The stats a slot gained or lost in the block (no `[from]`), in line order. */
  boosts: Record<string, string[]>;
}

const SLOT = /^(p[12][a-d])(?::|$)/;
const slotOf = (ident: string | undefined): string => SLOT.exec(ident ?? '')?.[1] ?? '';
const field = (parts: string[], index: number): string => parts[index] ?? '';
const bump = (record: Record<string, number>, slot: string, by = 1): void => { record[slot] = (record[slot] ?? 0) + by; };
const push = (record: Record<string, string[]>, slot: string, value: string): void => { (record[slot] ??= []).push(value); };

/** Lines that end an action's stretch: the next action, a switch, a blank line, the turn's edges. */
const BREAKS = new Set(['move', 'cant', 'switch', 'drag', 'replace', 'upkeep', 'turn', 'win', 'tie', '']);

function blank(type: LoggedAction['type'], ident = '', moveId = '', reason = ''): LoggedAction {
  return {
    type, slot: slotOf(ident), ident, moveId, reason, idents: ident ? { [slotOf(ident)]: ident } : {}, targets: [], missed: [], misses: 0,
    damaged: {}, crits: {}, hitCounts: {}, selfHits: {}, selfHitBy: {}, effects: {}, boosts: {},
  };
}

/** The slots a `|move|` line aims at: the aimed one, then the `[spread]` list. */
function aimOf(parts: string[]): string[] {
  const aimed = slotOf(field(parts, 4));
  const spread = parts.find(part => part.startsWith('[spread]'))?.slice('[spread]'.length).trim().split(',').filter(Boolean) ?? [];
  return [...new Set([...(aimed ? [aimed] : []), ...spread])];
}

/** The condition the log names when it writes a body's damage as its own confusion self-hit (the protocol's word, as the alignment reader reads it). */
const SELF_HIT = /\[from\] (confusion)\b/;

/** The effects a move leaves on a body (the caller has left out the lines with a `[from]`: those are the effects of items, abilities and the weather). */
function readEffect(action: LoggedAction, parts: string[], key: string): void {
  const tag = field(parts, 1);
  if (tag === '-status') push(action.effects, key, field(parts, 3));
  else if (tag === '-start') push(action.effects, key, toId(field(parts, 3).replace(/^[^:]*:\s*/, '')));
  else push(action.boosts, key, field(parts, 3));
}

const EFFECT_TAGS = new Set(['-status', '-start', '-boost', '-unboost']);

/** A `|-miss|` line: the target is the one the line names (Gens 1 and 2 name none: the move's aimed one). */
function readMiss(action: LoggedAction, parts: string[]): void {
  action.misses += 1;
  const target = slotOf(field(parts, 3)) || action.targets[0];
  if (!target) return;
  action.idents[target] ??= field(parts, 3);
  if (!action.missed.includes(target)) action.missed.push(target);
  if (!action.targets.includes(target)) action.targets.push(target);
}

/** A damage line: the confusion self-hit, or damage the move dealt (no `[from]`). */
function readDamage(action: LoggedAction, key: string, line: string): void {
  const selfHit = SELF_HIT.exec(line);
  if (selfHit) {
    bump(action.selfHits, key);
    action.selfHitBy[key] = selfHit[1];
  } else if (!line.includes('[from]')) {
    bump(action.damaged, key);
  }
}

function readLine(action: LoggedAction, parts: string[], line: string): void {
  const tag = field(parts, 1);
  const ident = field(parts, 2);
  // an older replay writes a hit count against the side (`p1: Garchomp`): that ident is its own key
  const key = slotOf(ident) || ident;
  if (key) action.idents[key] ??= ident;
  if (tag === '-miss') readMiss(action, parts);
  else if (tag === '-crit') bump(action.crits, key);
  else if (tag === '-hitcount') action.hitCounts[key] = Number(field(parts, 3));
  else if (tag === '-damage') readDamage(action, key, line);
  else if (EFFECT_TAGS.has(tag) && !line.includes('[from]')) readEffect(action, parts, key);
}

/** The log of a turn cut into actions; the lines before the first action and between actions form `other` stretches. */
export function loggedActions(turnLines: readonly string[]): LoggedAction[] {
  const actions: LoggedAction[] = [];
  let current = blank('other');
  let skipSecret = false;
  const open = (next: LoggedAction): void => {
    if (current.type !== 'other' || Object.keys(current.idents).length > 0 || current.misses > 0) actions.push(current);
    current = next;
  };
  for (const line of turnLines) {
    const parts = line.split('|');
    const tag = field(parts, 1);
    // a simulator log interleaves `|split|` + the secret line + the public line; the replay's protocol has the public one only
    if (tag === 'split') { skipSecret = true; continue; }
    if (skipSecret) { skipSecret = false; continue; }
    if (BREAKS.has(tag)) {
      if (tag === 'move') {
        const action = blank('move', field(parts, 2), toId(field(parts, 3)));
        action.targets = aimOf(parts);
        const aimed = slotOf(field(parts, 4));
        if (aimed) action.idents[aimed] = field(parts, 4);
        if (line.includes('[miss]')) {
          action.misses += 1;
          if (aimed && !action.missed.includes(aimed)) action.missed.push(aimed);
        }
        open(action);
      } else if (tag === 'cant') {
        open(blank('cant', field(parts, 2), '', toId(field(parts, 3))));
      } else {
        open(blank('other'));
      }
      continue;
    }
    readLine(current, parts, line);
  }
  if (current.type !== 'other' || Object.keys(current.idents).length > 0 || current.misses > 0) actions.push(current);
  return actions;
}

const happens = (value: boolean): { happens: boolean } => ({ happens: value });
const ofMove = (action: LoggedAction) => ({ slot: action.slot, moveId: action.moveId });

/** The crit of one target: yes when every damage line crit, no when none did, nothing when the hits of a multi-hit move disagree. */
function critOf(action: LoggedAction, target: string): boolean | null {
  const damaged = action.damaged[target] ?? 0;
  const crits = action.crits[target] ?? 0;
  if (crits > 0) return crits >= damaged ? true : null;
  return damaged > 0 ? false : null;
}

/** The effect ids a target shows after the move: its status and volatile ids, and the stats it moved (`boosts:` and `self:`). */
function shownEffects(action: LoggedAction, target: string, self: boolean): string[] {
  const stats = action.boosts[target] ?? [];
  const ids = [...(action.effects[target] ?? [])];
  if (stats.length > 0) ids.push(`${self ? 'self' : 'boosts'}:${stats.join('+')}`);
  return ids;
}

/** Whether `slot` acts later in the turn than the action at `index` (the log shows then that a flinch did not stop it). */
const actsAfter = (actions: readonly LoggedAction[], index: number, slot: string): boolean =>
  actions.slice(index + 1).some(action => action.type === 'move' && action.slot === slot);

/** The slots a `|cant|` flinch stopped, by the index of the action that flinched them: the last move before it that hit them. */
function flinchedBy(actions: readonly LoggedAction[]): Map<number, Set<string>> {
  const flinched = new Map<number, Set<string>>();
  actions.forEach((action, index) => {
    if (action.type !== 'cant' || action.reason !== 'flinch') return;
    for (let before = index - 1; before >= 0; before--) {
      const source = actions[before];
      if (source.type !== 'move' || source.slot === action.slot) continue;
      if (source.targets.includes(action.slot) && !source.missed.includes(action.slot)) {
        flinched.set(before, (flinched.get(before) ?? new Set()).add(action.slot));
        return;
      }
    }
  });
  return flinched;
}

function moveDice(
  actions: readonly LoggedAction[], index: number, flinched: ReadonlySet<string>, options: LoggedOptions,
): ForcedDie[] {
  const action = actions[index];
  const dice: ForcedDie[] = [];
  const foes = action.targets.filter(target => target !== action.slot);
  const entries = options.secondariesOf?.(action.moveId) ?? [];
  for (const target of foes) {
    const missed = action.missed.includes(target);
    dice.push({ name: { ...ofMove(action), targetSlot: target, kind: 'accuracy' }, result: happens(!missed) });
    if (missed) continue;
    const crit = critOf(action, target);
    if (crit !== null) dice.push({ name: { ...ofMove(action), targetSlot: target, kind: 'crit' }, result: happens(crit) });
    const shown = shownEffects(action, target, false);
    if (flinched.has(target)) shown.push('flinch');
    const self = shownEffects(action, action.slot, true).filter(id => id.startsWith('self:'));
    const seen = [...shown, ...self];
    for (const effectId of entries) {
      const fired = seen.includes(effectId);
      // a flinch the log disproves needs a later move of the target; a stat change the log shows reads as it is
      if (!fired && effectId === 'flinch' && !actsAfter(actions, index, target)) continue;
      dice.push({ name: { ...ofMove(action), targetSlot: target, kind: 'secondary', effectId }, result: happens(fired) });
    }
    for (const effectId of seen.filter(id => !entries.includes(id))) {
      dice.push({ name: { ...ofMove(action), targetSlot: target, kind: 'secondary', effectId }, result: happens(true) });
    }
  }
  const counts = Object.values(action.hitCounts);
  if (counts.length > 0) dice.push({ name: { ...ofMove(action), kind: 'hit-count' }, result: { hits: counts[0] } });
  if (foes.length > 0 && shownEffects(action, action.slot, true).some(id => id.startsWith('self:'))) {
    dice.push({ name: { ...ofMove(action), kind: 'self-effect' }, result: happens(true) });
  }
  return dice;
}

/**
 * Status checks: a `|cant|` reason stops the body (no); with the checks the caller names, a body that acted passed them (yes)
 * and a body whose log shows the confusion self-hit failed that one.
 */
function checkDice(actions: readonly LoggedAction[], options: LoggedOptions): ForcedDie[] {
  const dice: ForcedDie[] = [];
  const clicked = (slot: string): string | undefined => options.clicked?.get(slot);
  for (const action of actions) {
    const moveId = clicked(action.slot);
    if (action.type === 'cant' && action.reason && action.reason !== 'flinch' && moveId) {
      dice.push({ name: { slot: action.slot, moveId, kind: 'status-check', effectId: action.reason }, result: happens(false) });
    }
  }
  for (const [slot, ids] of options.checks ?? []) {
    const acted = actions.find(action => action.type === 'move' && action.slot === slot);
    for (const effectId of ids) {
      const stopped = actions.some(action => action.type === 'cant' && action.slot === slot && action.reason === effectId);
      if (stopped) continue;
      if (actions.some(action => action.selfHitBy[slot] === effectId)) {
        const moveId = clicked(slot);
        if (moveId) dice.push({ name: { slot, moveId, kind: 'status-check', effectId }, result: happens(false) });
      } else if (acted) {
        dice.push({ name: { slot, moveId: acted.moveId, kind: 'status-check', effectId }, result: happens(true) });
      }
    }
  }
  return dice;
}

/**
 * The dice a log shows for the turn, per action in the log's order: accuracy and crit per target the move reached, its
 * secondaries and self effect, its hit count, and the status checks. The names are the names the module gives the draws
 * (`recognize.ts`), so a forced list made of them forces what the log rolled.
 */
export function loggedDice(turnLines: readonly string[], options: LoggedOptions = {}): ForcedDie[] {
  const actions = loggedActions(turnLines);
  const flinched = flinchedBy(actions);
  const dice: ForcedDie[] = [];
  actions.forEach((action, index) => {
    if (action.type === 'move') dice.push(...moveDice(actions, index, flinched.get(index) ?? new Set(), options));
  });
  dice.push(...checkDice(actions, options));
  const seen = new Set<string>();
  return dice.filter(die => {
    const key = dieKey(die.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface MergeInput {
  /** What the log shows for the turn (`loggedDice`). */
  logged: readonly ForcedDie[];
  /** The dice the user forced. */
  forced: readonly ForcedDie[];
  /** The slots whose action the user changed (another move, another aim, a switch): their logged dice no longer hold. */
  changed: ReadonlySet<string>;
  /** The slots the user switched: a die aimed at the body that left no longer holds. */
  switched?: ReadonlySet<string>;
}

/**
 * The forced dice of the first turn (19a): the user's dice, and the logged dice of the actions left as logged. The user's die
 * wins where both name the same die. A turn with nothing forced stays a turn with nothing forced: it plays as today.
 */
export function mergeLoggedDice({ logged, forced, changed, switched }: MergeInput): ForcedDie[] {
  if (forced.length === 0) return [];
  const taken = new Set(forced.map(die => dieKey(die.name)));
  const kept = logged.filter(die => !taken.has(dieKey(die.name)) && !changed.has(die.name.slot)
    && !(die.name.targetSlot !== undefined && switched?.has(die.name.targetSlot)));
  return [...forced, ...kept];
}
