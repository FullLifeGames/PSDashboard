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
