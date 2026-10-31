import {
  dieKey, dieLabel, type BranchSlotChoice, type DieName, type DieOffer, type DieWords, type ForcedDie, type LiveHit,
} from '@fulllifegames/eval-engine';

/**
 * Round 82 (forced dice), step A7a: the words and the edits of the dice chips in the branch panel. The chips take their dice
 * from the engine's offers (`offeredDice`, `offeredOrderDice`, `offeredEndDice`); this file turns a die into the text a user
 * reads and a click into a new list of dice for the slot's choice. Names come from the battle's own Dex (`battle.dex`) and its
 * bodies, never from a list of ours.
 */

type Battle = LiveHit['battle'];

/**
 * The six status conditions in the words a user reads. The Dex names them by their short id ("brn"); a spec holds this table to the
 * Dex's status conditions. A volatile (flinch, confusion) reads its Dex name.
 */
export const STATUS_WORDS: Record<string, string> = {
  brn: 'Burn', par: 'Paralysis', slp: 'Sleep', frz: 'Freeze', psn: 'Poison', tox: 'Toxic',
};

const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The effect id without the suffix the engine gives a die with several results (`effectspore:option`). */
const effectOf = (name: DieName): string => (name.effectId ?? '').split(':option')[0];

type Namer = { get(id: string): { exists: boolean; name: string } };

/** An ability, an item, a move or a condition by its id, read from the battle's Dex. */
function dexName(battle: Battle, id: string): string {
  const dex = battle.dex as unknown as Record<'abilities' | 'items' | 'moves' | 'conditions', Namer>;
  for (const table of [dex.abilities, dex.items, dex.moves, dex.conditions]) {
    const entry = table.get(id);
    if (entry.exists) return upperFirst(entry.name);
  }
  return id;
}

/** The stats an entry changes ("atk+def") in the Dex's stat names, joined with a plus sign. */
function statsWord(battle: Battle, stats: string): string {
  const names = (battle.dex as unknown as { stats: { names: Record<string, string> } }).stats.names;
  return stats.split('+').map(stat => names[stat] ?? upperFirst(stat)).join(' + ');
}

function effectWord(battle: Battle, id: string): string {
  if (STATUS_WORDS[id]) return STATUS_WORDS[id];
  if (id.startsWith('boosts:')) return `${statsWord(battle, id.slice('boosts:'.length))} change`;
  if (id.startsWith('self:')) {
    const own = id.slice('self:'.length);
    const stats = own.split('+').every(stat => stat in (battle.dex as unknown as { stats: { names: object } }).stats.names);
    return `Own ${stats ? `${statsWord(battle, own)} change` : effectWord(battle, own).toLowerCase()}`;
  }
  return dexName(battle, id);
}

const bodyAt = (battle: Battle, slot: string) => battle.sides[slot[1] === '1' ? 0 : 1]?.active[slot[2] === 'a' ? 0 : 1];

/** The reader of names for `dieLabel` and the chips: moves and effects from the battle's Dex, bodies by their names in the battle. */
export function wordsOf(battle: Battle): DieWords {
  return {
    move: id => dexName(battle, id),
    effect: id => effectWord(battle, id),
    slot: slot => bodyAt(battle, slot)?.name ?? slot,
  };
}

/**
 * The words of one chip: what the result says, without the subject (the group's caption names that). `dieLabel` writes
 * "subject: result"; the subject may hold a colon itself (a body named "Type: Null"), the result never does.
 */
export function resultWord(die: ForcedDie, words: DieWords): string {
  if ('option' in die.result) return upperFirst(words.effect(die.result.option));
  const label = dieLabel(die, words);
  return upperFirst(label.slice(label.lastIndexOf(': ') + 2));
}

/** The caption above the chips of one die. */
export function captionOf(name: DieName, words: DieWords): string {
  switch (name.kind) {
    case 'accuracy': return 'Hit';
    case 'crit': return 'Crit';
    case 'damage-roll': return 'Damage roll';
    case 'self-effect': return 'Stat change';
    case 'hit-count': return 'Hits';
    case 'power': return 'Power';
    case 'speed-tie': return 'Speed tie';
    case 'status-check': return `${words.effect(effectOf(name))} check`;
    case 'stalling': return words.move(name.moveId);
    case 'move-first': return `${words.effect(effectOf(name))} on ${words.slot(name.slot)}`;
    default: return words.effect(effectOf(name));
  }
}

const sameResult = (a: ForcedDie, b: ForcedDie): boolean => JSON.stringify(a.result) === JSON.stringify(b.result);

/**
 * A click on a chip: the die is set when its key has none, takes the new result when the key has another, and goes when the
 * result is the one already set.
 */
export function toggleDie(dice: readonly ForcedDie[], die: ForcedDie): ForcedDie[] {
  const key = dieKey(die.name);
  const held = dice.find(entry => dieKey(entry.name) === key);
  if (!held) return [...dice, die];
  if (sameResult(held, die)) return dice.filter(entry => entry !== held);
  return dice.map(entry => (entry === held ? die : entry));
}

/** The choice with its forced dice; an empty list leaves no `dice` key behind (the key rides in saves and share links). */
export function withDice(choice: BranchSlotChoice, dice: readonly ForcedDie[]): BranchSlotChoice {
  const rest = { ...choice };
  delete rest.dice;
  return dice.length > 0 ? { ...rest, dice: [...dice] } : rest;
}

/** The dice of the turn that belong to no single move: the order of the actions and the end of the turn. */
export const TURN_KINDS: ReadonlySet<DieName['kind']> = new Set(['speed-tie', 'move-first', 'end-of-turn']);

/** One set of chips: the dice of one target, or the dice of the move that name no target. */
export interface ChipGroup { key: string; target?: string; offers: DieOffer[] }

/**
 * The offers grouped for display: a move with one target shows one set, a move with several (a spread move in doubles) one set per
 * target, and the dice that name no target (the hit count, a status check) in a last set.
 */
export function chipGroups(offers: readonly DieOffer[]): ChipGroup[] {
  const targets = [...new Set(offers.map(offer => offer.name.targetSlot).filter((slot): slot is string => slot !== undefined))];
  if (targets.length <= 1) return offers.length > 0 ? [{ key: 'all', offers: [...offers] }] : [];
  const groups: ChipGroup[] = targets.map(target => ({ key: target, target, offers: offers.filter(offer => offer.name.targetSlot === target) }));
  const rest = offers.filter(offer => offer.name.targetSlot === undefined);
  return rest.length > 0 ? [...groups, { key: 'move', offers: rest }] : groups;
}

/**
 * Dice that only happen when the move hits: the crit and the damage roll are drawn for a hit, a secondary effect, the hit count,
 * the self effect and the procs of the target's ability and item follow one (decision 5a).
 */
const NEEDS_HIT: ReadonlySet<DieName['kind']> = new Set(['crit', 'damage-roll', 'secondary', 'hit-count', 'self-effect', 'ability-proc', 'item-proc']);

const sameMove = (a: DieName, b: DieName): boolean => a.slot === b.slot && a.moveId === b.moveId;
/** A die that names a target needs the hit on that target; one that names none needs the hit on every target. */
const needsHitOn = (die: DieName, accuracy: DieName): boolean => NEEDS_HIT.has(die.kind) && sameMove(die, accuracy) && (die.targetSlot === undefined || die.targetSlot === accuracy.targetSlot);

const isSet = (dice: readonly ForcedDie[], die: ForcedDie): boolean => dice.some(entry => dieKey(entry.name) === dieKey(die.name) && sameResult(entry, die));

/** Gives the dice their results, in the place of the die with the same key when there is one. */
function setAll(dice: readonly ForcedDie[], pulled: readonly ForcedDie[]): ForcedDie[] {
  return pulled.reduce<ForcedDie[]>((held, die) => {
    const key = dieKey(die.name);
    return held.some(entry => dieKey(entry.name) === key) ? held.map(entry => (dieKey(entry.name) === key ? die : entry)) : [...held, die];
  }, [...dice]);
}

/** The dice of the move's own offers that its forced die needs: the hit on its target and the attacker's status checks (it has to act). */
function pulledFor(die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] {
  return offers
    .filter(offer => sameMove(offer.name, die.name)
      && ((offer.name.kind === 'accuracy' && (die.name.targetSlot === undefined || offer.name.targetSlot === die.name.targetSlot)) || offer.name.kind === 'status-check'))
    .map(offer => ({ name: offer.name, result: { happens: true } }));
}

/** A miss or a body that cannot act: the dice that need the hit have nothing to decide. */
const stopsTheMove = (die: ForcedDie): boolean =>
  (die.name.kind === 'accuracy' || die.name.kind === 'status-check') && 'happens' in die.result && !die.result.happens;

/**
 * A click on a chip of a slot's move. It toggles the die as `toggleDie` does and then settles the dice around it: a die that needs
 * the hit sets the hit on its target and passes the attacker's status checks (a result that contradicts them gives way); a miss
 * or a stopped body takes back the dice that need the hit.
 */
export function applyDie(dice: readonly ForcedDie[], die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] {
  const next = toggleDie(dice, die);
  if (!isSet(next, die)) return next;
  if (NEEDS_HIT.has(die.name.kind)) return setAll(next, pulledFor(die, offers));
  if (!stopsTheMove(die)) return next;
  const stopped = die.name.kind === 'status-check';
  return next.filter(entry => !(NEEDS_HIT.has(entry.name.kind) && sameMove(entry.name, die.name) && (stopped || needsHitOn(entry.name, die.name))));
}

/** What a die that needs the hit is called in a sentence. */
function needOf(die: ForcedDie, words: DieWords): string {
  switch (die.name.kind) {
    case 'crit': return 'the crit';
    case 'damage-roll': return 'the damage roll';
    case 'hit-count': return 'the hit count';
    case 'self-effect': return 'the stat change';
    case 'secondary': return `the ${words.effect((die.name.effectId ?? '').split(':option')[0]).toLowerCase()}`;
    default: return words.effect((die.name.effectId ?? '').split(':option')[0]);
  }
}

/**
 * The reasons a hit or a passed check stands set: one sentence per set die of the move that another die needs. The chips show
 * the dice as set; the sentences say why (decision 5a).
 */
export function pullNotes(dice: readonly ForcedDie[], offers: readonly DieOffer[], words: DieWords): string[] {
  const offered = new Set(offers.map(offer => dieKey(offer.name)));
  const notes: string[] = [];
  for (const held of dice) {
    const yes = 'happens' in held.result && held.result.happens;
    if (!yes || !offered.has(dieKey(held.name))) continue;
    const needing = dice.find(entry => NEEDS_HIT.has(entry.name.kind) && sameMove(entry.name, held.name)
      && (held.name.kind === 'status-check' || needsHitOn(entry.name, held.name)));
    if (!needing) continue;
    if (held.name.kind === 'accuracy') {
      notes.push(`${words.move(held.name.moveId)} hits ${words.slot(held.name.targetSlot ?? '')} because ${needOf(needing, words)} needs a hit.`);
    } else if (held.name.kind === 'status-check') {
      notes.push(`${words.slot(held.name.slot)} passes the ${words.effect(held.name.effectId ?? '')} check because ${needOf(needing, words)} needs it to move.`);
    }
  }
  return notes;
}
