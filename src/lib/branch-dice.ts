import {
  chainCount, chainResults, dieKey, dieLabel,
  type BranchSlotChoice, type DieName, type DieOffer, type DieReport, type DieWords, type ForcedDie, type HitResult, type LiveHit,
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

/** A target as the table's head and the cells' labels name it: its slot and its body ("P2A Calyrex"), so two bodies of one species stay apart. */
export const targetHeading = (target: string, words: DieWords): string => `${target.toUpperCase()} ${words.slot(target)}`;

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

/** One row of the dice table: one kind of die, with its die for each column (null where that target has none). */
export interface DiceRow { key: string; cells: (DieOffer | null)[] }

/** The dice of a move as a table: `heads` are the target slots of the columns (empty: one column without a head). */
export interface DiceTableModel { heads: string[]; rows: DiceRow[]; shared: DieOffer[] }

const keyWithoutTarget = (name: DieName): string => dieKey({ ...name, targetSlot: undefined });

/**
 * Round 89 (#114, F3; the user's ruling 31): the accuracy die of a later hit (`hit` 2 and up) of a move whose every hit rolls its own
 * accuracy. The panel shows no row for it: the hits of one move and target fold into one "Hits" row with the counts 1 to N, the way
 * the hit count of Bullet Seed shows (a count die, `hit-count`, that names its target; the real hit count names none). The die the
 * chips hand over for a count is that die with the result `{ hits: k }`; `applyDie` turns it into the per-hit dice the engine offers.
 */
const isLaterHit = (name: DieName): boolean => name.kind === 'accuracy' && name.hit !== undefined;

const plainName = (name: DieName): DieName => {
  const plain = { ...name };
  delete plain.hit;
  return plain;
};

/** The die the Hits row's chips stand for: the count of landed hits on one target of one move. */
export const isCountDie = (name: DieName): boolean => name.kind === 'hit-count' && name.targetSlot !== undefined;

const sameTarget = (a: DieName, b: DieName): boolean => sameMove(a, b) && a.targetSlot === b.targetSlot;

const hitResult = (die: ForcedDie): HitResult => ({ hit: die.name.hit!, happens: 'happens' in die.result && die.result.happens });

/** The count of landed hits the dice of one move and target set (their later hits), or undefined when none of them is set. */
export function heldHits(dice: readonly ForcedDie[], name: DieName): number | undefined {
  const held = dice.filter(die => isLaterHit(die.name) && sameTarget(die.name, name));
  return held.length === 0 ? undefined : chainCount(held.map(hitResult));
}

/** One count die for each move and target that offers later hits: the counts 1 to the hits of the move. */
function countOffers(later: readonly DieOffer[]): DieOffer[] {
  const groups = new Map<string, DieOffer[]>();
  for (const offer of later) {
    const key = `${offer.name.slot}:${offer.name.moveId}:${offer.name.targetSlot ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return [...groups.values()].map(group => ({
    name: { ...plainName(group[0].name), kind: 'hit-count' },
    results: Array.from({ length: group.length + 1 }, (_, index) => ({ hits: index + 1 })),
  }));
}

/**
 * Round 84 (turn dock), step A4: the offers as a table. A move with several targets (a spread move in doubles) gets one column per
 * target and one row per kind of die, so a die lines up with its twin on the other target; the dice that name no target (the hit
 * count, a status check) stand apart in `shared`. A move with one target is one column without a head, a row per die. Round 89
 * (#114): the later hits of a multi-accuracy move are one "Hits" row of counts under the "Hit" row of the move (see `isLaterHit`).
 */
export function diceTable(offers: readonly DieOffer[]): DiceTableModel {
  const table = plainTable(offers.filter(offer => !isLaterHit(offer.name)));
  const counts = countOffers(offers.filter(offer => isLaterHit(offer.name)));
  if (counts.length === 0) return table;
  const rows = [...table.rows];
  const aimed = (row: DiceRow, count: DieOffer) => row.cells.some(cell => cell?.name.kind === 'accuracy' && cell.name.slot === count.name.slot && cell.name.moveId === count.name.moveId);
  const spots = new Map<string, DieOffer[]>();
  for (const count of counts) spots.set(`${count.name.slot}:${count.name.moveId}`, [...(spots.get(`${count.name.slot}:${count.name.moveId}`) ?? []), count]);
  for (const group of spots.values()) {
    const row: DiceRow = table.heads.length === 0
      ? { key: dieKey(group[0].name), cells: [group[0]] }
      : { key: keyWithoutTarget(group[0].name), cells: table.heads.map(head => group.find(count => count.name.targetSlot === head) ?? null) };
    const after = rows.findIndex(held => aimed(held, group[0]));
    rows.splice(after < 0 ? rows.length : after + 1, 0, row);
  }
  return { ...table, rows };
}

function plainTable(offers: readonly DieOffer[]): DiceTableModel {
  const heads = [...new Set(offers.map(offer => offer.name.targetSlot).filter((slot): slot is string => slot !== undefined))];
  if (heads.length <= 1) return { heads: [], rows: offers.map(offer => ({ key: dieKey(offer.name), cells: [offer] })), shared: [] };
  const aimed = offers.filter(offer => offer.name.targetSlot !== undefined);
  const keys = [...new Set(aimed.map(offer => keyWithoutTarget(offer.name)))];
  const rows = keys.map(key => ({
    key,
    cells: heads.map(head => aimed.find(offer => offer.name.targetSlot === head && keyWithoutTarget(offer.name) === key) ?? null),
  }));
  return { heads, rows, shared: offers.filter(offer => offer.name.targetSlot === undefined) };
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

/**
 * The dice of the move's own offers that its forced die needs: the hit on its target (the first hit's die, which covers every hit of
 * the move: a later hit has a die of its own only when the user sets a count) and the attacker's status checks (it has to act).
 */
function pulledFor(die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] {
  return offers
    .filter(offer => sameMove(offer.name, die.name)
      && ((offer.name.kind === 'accuracy' && !isLaterHit(offer.name) && (die.name.targetSlot === undefined || offer.name.targetSlot === die.name.targetSlot)) || offer.name.kind === 'status-check'))
    .map(offer => ({ name: offer.name, result: { happens: true } }));
}

/** A miss of the first hit or a body that cannot act: the dice that need the hit have nothing to decide. A later hit that misses ends a chain, not the move. */
const stopsTheMove = (die: ForcedDie): boolean =>
  ((die.name.kind === 'accuracy' && !isLaterHit(die.name)) || die.name.kind === 'status-check') && 'happens' in die.result && !die.result.happens;

/**
 * A click on a chip of the Hits row (`isCountDie`) when the offers hold the later hits of that move and target: the first hit lands,
 * and the later hits are the chain `chainResults` writes for the count (hits 2 to k land, hit k + 1 misses; the last count is all
 * landing). The count already set gives its hit dice back and leaves the first hit, as any die a click gives back.
 */
function applyCount(dice: readonly ForcedDie[], die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] | undefined {
  if (!isCountDie(die.name) || !('hits' in die.result)) return undefined;
  const later = offers.filter(offer => isLaterHit(offer.name) && sameTarget(offer.name, die.name));
  if (later.length === 0) return undefined;
  const rest = dice.filter(held => !(isLaterHit(held.name) && sameTarget(held.name, die.name)));
  if (heldHits(dice, die.name) === die.result.hits) return rest;
  const chain = chainResults(die.result.hits, later.length + 1).map(({ hit, happens }): ForcedDie => ({ name: { ...plainName(die.name), kind: 'accuracy', hit }, result: { happens } }));
  return [...setAll(rest, pulledFor(die, offers)), ...chain];
}

/**
 * A click on a chip of a slot's move. It toggles the die as `toggleDie` does and then settles the dice around it: a die that needs
 * the hit sets the hit on its target and passes the attacker's status checks (a result that contradicts them gives way); a miss
 * or a stopped body takes back the dice that need the hit.
 */
export function applyDie(dice: readonly ForcedDie[], die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] {
  const counted = applyCount(dice, die, offers);
  if (counted) return counted;
  const next = toggleDie(dice, die);
  if (!isSet(next, die)) return next;
  if (NEEDS_HIT.has(die.name.kind)) return setAll(next, pulledFor(die, offers));
  if (!stopsTheMove(die)) return next;
  const stopped = die.name.kind === 'status-check';
  // the later hits of the move on that target (a chain) need the first hit as well
  const needsHit = (entry: ForcedDie): boolean => needsHitOn(entry.name, die.name) || (isLaterHit(entry.name) && sameTarget(entry.name, die.name));
  return next.filter(entry => !((NEEDS_HIT.has(entry.name.kind) || isLaterHit(entry.name)) && sameMove(entry.name, die.name) && (stopped || needsHit(entry))));
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
    if (!yes || isLaterHit(held.name) || !offered.has(dieKey(held.name))) continue;
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

/**
 * Round 89 (#114): the report of the dice the user forced, with the later hits of one move and target as one die of the count they
 * set ("Triple Axel: 2 hits"), so the history row, the share link and the frame's lines say it once. The count is the engine's
 * `chainCount` of the hit dice; the entry takes the place of the first hit die, its log index, and the report of the first die that
 * did not apply (a miss that ended the chain in advance, a die the simulator never drew, does not count against the hits that landed:
 * the chain ended at or before it).
 */
export function foldHitReports(forced: readonly DieReport[]): DieReport[] {
  const keyOf = (name: DieName) => `${name.slot}:${name.moveId}:${name.targetSlot ?? ''}`;
  const groups = new Map<string, DieReport[]>();
  for (const entry of forced) if (isLaterHit(entry.die.name)) groups.set(keyOf(entry.die.name), [...(groups.get(keyOf(entry.die.name)) ?? []), entry]);
  return forced.flatMap((entry): DieReport[] => {
    if (!isLaterHit(entry.die.name)) return [entry];
    const group = groups.get(keyOf(entry.die.name))!;
    if (group[0] !== entry) return [];
    const failed = group.find(held => held.took !== 'applied' && !(held.took === 'no-draw' && 'happens' in held.die.result && !held.die.result.happens));
    const logged = group.map(held => held.logIndex).filter((index): index is number => index !== undefined);
    return [{
      die: { name: { ...plainName(entry.die.name), kind: 'hit-count' }, result: { hits: chainCount(group.map(held => hitResult(held.die))) } },
      took: failed?.took ?? 'applied',
      ...(failed?.reason !== undefined ? { reason: failed.reason } : {}),
      ...(logged.length > 0 ? { logIndex: Math.min(...logged) } : {}),
    }];
  });
}
