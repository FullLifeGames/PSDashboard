import {
  chainCount, chainResults, dieKey, dieLabel,
  type BranchSlotChoice, type DieName, type DieOffer, type DieReport, type DieWords, type ForcedDie, type HitResult, type LiveHit,
} from '@fulllifegames/eval-engine';


type Battle = LiveHit['battle'];

/** The six status conditions by Dex id in the words a user reads; a spec holds the table to the Dex. */
export const STATUS_WORDS: Record<string, string> = {
  brn: 'Burn', par: 'Paralysis', slp: 'Sleep', frz: 'Freeze', psn: 'Poison', tox: 'Toxic',
};

const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const effectOf = (name: DieName): string => (name.effectId ?? '').split(':option')[0];

type Namer = { get(id: string): { exists: boolean; name: string } };

function dexName(battle: Battle, id: string): string {
  const dex = battle.dex as unknown as Record<'abilities' | 'items' | 'moves' | 'conditions', Namer>;
  for (const table of [dex.abilities, dex.items, dex.moves, dex.conditions]) {
    const entry = table.get(id);
    if (entry.exists) return upperFirst(entry.name);
  }
  return id;
}

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

function plainWord(battle: Battle, id: string): string {
  const word = effectWord(battle, id);
  const dex = battle.dex as unknown as Record<'abilities' | 'items' | 'moves' | 'conditions', Namer>;
  const condition = STATUS_WORDS[id] !== undefined || (dex.conditions.get(id).exists && ![dex.abilities, dex.items, dex.moves].some(table => table.get(id).exists));
  return condition ? word.charAt(0).toLowerCase() + word.slice(1) : word;
}

const bodyAt = (battle: Battle, slot: string) => battle.sides[slot[1] === '1' ? 0 : 1]?.active[slot[2] === 'a' ? 0 : 1];

export function wordsOf(battle: Battle): DieWords {
  return {
    move: id => dexName(battle, id),
    effect: id => effectWord(battle, id),
    plain: id => plainWord(battle, id),
    slot: slot => bodyAt(battle, slot)?.name ?? slot,
  };
}

/** The words of one chip without the subject; the subject may hold a colon ("Type: Null"), the result not. */
export function resultWord(die: ForcedDie, words: DieWords): string {
  if ('option' in die.result) return upperFirst(words.effect(die.result.option));
  const label = dieLabel(die, words);
  return upperFirst(label.slice(label.lastIndexOf(': ') + 2));
}

/** "P2A Calyrex": the slot with its body, so two bodies of one species stay apart. */
export const targetHeading = (target: string, words: DieWords): string => `${target.toUpperCase()} ${words.slot(target)}`;

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

export function toggleDie(dice: readonly ForcedDie[], die: ForcedDie): ForcedDie[] {
  const key = dieKey(die.name);
  const held = dice.find(entry => dieKey(entry.name) === key);
  if (!held) return [...dice, die];
  if (sameResult(held, die)) return dice.filter(entry => entry !== held);
  return dice.map(entry => (entry === held ? die : entry));
}

/** The choice with its forced dice; an empty list leaves no `dice` key (it rides in saves and share links). */
export function withDice(choice: BranchSlotChoice, dice: readonly ForcedDie[]): BranchSlotChoice {
  const rest = { ...choice };
  delete rest.dice;
  return dice.length > 0 ? { ...rest, dice: [...dice] } : rest;
}

export const TURN_KINDS: ReadonlySet<DieName['kind']> = new Set(['speed-tie', 'move-first', 'end-of-turn']);

/** One die per column (null where that target has none). */
export interface DiceRow { key: string; cells: (DieOffer | null)[] }

/** `heads` are the target slots of the columns (empty: one column without a head). */
export interface DiceTableModel { heads: string[]; rows: DiceRow[]; shared: DieOffer[] }

const keyWithoutTarget = (name: DieName): string => dieKey({ ...name, targetSlot: undefined });

// The panel folds later hits into one "Hits" row of counts 1 to N (a `hit-count` die); `applyDie` unfolds it.
const isLaterHit = (name: DieName): boolean => name.kind === 'accuracy' && name.hit !== undefined;

const plainName = (name: DieName): DieName => {
  const plain = { ...name };
  delete plain.hit;
  return plain;
};

export const isCountDie = (name: DieName): boolean => name.kind === 'hit-count' && name.targetSlot !== undefined;

const sameTarget = (a: DieName, b: DieName): boolean => sameMove(a, b) && a.targetSlot === b.targetSlot;

const hitResult = (die: ForcedDie): HitResult => ({ hit: die.name.hit!, happens: 'happens' in die.result && die.result.happens });

export function heldHits(dice: readonly ForcedDie[], name: DieName): number | undefined {
  const held = dice.filter(die => isLaterHit(die.name) && sameTarget(die.name, name));
  return held.length === 0 ? undefined : chainCount(held.map(hitResult));
}

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

/** A spread move gets a column per target and a row per kind of die; dice that name no target stand in `shared`. */
export function diceTable(offers: readonly DieOffer[]): DiceTableModel {
  const table = plainTable(offers.filter(offer => !isLaterHit(offer.name)));
  const counts = countOffers(offers.filter(offer => isLaterHit(offer.name)));
  if (counts.length === 0) return { ...table, rows: countsUnderHit(table.rows) };
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
  return { ...table, rows: countsUnderHit(rows) };
}

// The engine's own hit count (Tail Slap, Bullet Seed) names no target and comes last; its row moves under "Hit".
function countsUnderHit(rows: readonly DiceRow[]): DiceRow[] {
  const isHitCount = (row: DiceRow) => row.cells.length === 1 && row.cells[0]?.name.kind === 'hit-count' && row.cells[0].name.targetSlot === undefined;
  const out = rows.filter(row => !isHitCount(row));
  for (const row of rows.filter(isHitCount)) {
    const name = row.cells[0]!.name;
    const hit = out.findIndex(held => held.cells.some(cell => cell?.name.kind === 'accuracy' && cell.name.hit === undefined && cell.name.slot === name.slot && cell.name.moveId === name.moveId));
    out.splice(hit < 0 ? out.length : hit + 1, 0, row);
  }
  return out;
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

const NEEDS_HIT: ReadonlySet<DieName['kind']> = new Set(['crit', 'damage-roll', 'secondary', 'hit-count', 'self-effect', 'ability-proc', 'item-proc']);

const sameMove = (a: DieName, b: DieName): boolean => a.slot === b.slot && a.moveId === b.moveId;
const needsHitOn = (die: DieName, accuracy: DieName): boolean => NEEDS_HIT.has(die.kind) && sameMove(die, accuracy) && (die.targetSlot === undefined || die.targetSlot === accuracy.targetSlot);

const isSet = (dice: readonly ForcedDie[], die: ForcedDie): boolean => dice.some(entry => dieKey(entry.name) === dieKey(die.name) && sameResult(entry, die));

function setAll(dice: readonly ForcedDie[], pulled: readonly ForcedDie[]): ForcedDie[] {
  return pulled.reduce<ForcedDie[]>((held, die) => {
    const key = dieKey(die.name);
    return held.some(entry => dieKey(entry.name) === key) ? held.map(entry => (dieKey(entry.name) === key ? die : entry)) : [...held, die];
  }, [...dice]);
}

// The first hit's die covers every hit; a later hit has a die of its own only when the user sets a count.
function pulledFor(die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] {
  return offers
    .filter(offer => sameMove(offer.name, die.name)
      && ((offer.name.kind === 'accuracy' && !isLaterHit(offer.name) && (die.name.targetSlot === undefined || offer.name.targetSlot === die.name.targetSlot)) || offer.name.kind === 'status-check'))
    .map(offer => ({ name: offer.name, result: { happens: true } }));
}

const stopsTheMove = (die: ForcedDie): boolean =>
  ((die.name.kind === 'accuracy' && !isLaterHit(die.name)) || die.name.kind === 'status-check') && 'happens' in die.result && !die.result.happens;

// Count k: the first hit lands, hits 2 to k land, hit k + 1 misses (the last count is all landing).
function applyCount(dice: readonly ForcedDie[], die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] | undefined {
  if (!isCountDie(die.name) || !('hits' in die.result)) return undefined;
  const later = offers.filter(offer => isLaterHit(offer.name) && sameTarget(offer.name, die.name));
  if (later.length === 0) return undefined;
  const rest = dice.filter(held => !(isLaterHit(held.name) && sameTarget(held.name, die.name)));
  if (heldHits(dice, die.name) === die.result.hits) return rest;
  const chain = chainResults(die.result.hits, later.length + 1).map(({ hit, happens }): ForcedDie => ({ name: { ...plainName(die.name), kind: 'accuracy', hit }, result: { happens } }));
  return [...setAll(rest, pulledFor(die, offers)), ...chain];
}

/** A click on a chip of a slot's move: toggles the die, then settles the dice that need it (the hit, status checks). */
export function applyDie(dice: readonly ForcedDie[], die: ForcedDie, offers: readonly DieOffer[]): ForcedDie[] {
  const counted = applyCount(dice, die, offers);
  if (counted) return counted;
  const next = toggleDie(dice, die);
  if (!isSet(next, die)) return next;
  if (NEEDS_HIT.has(die.name.kind)) return setAll(next, pulledFor(die, offers));
  if (!stopsTheMove(die)) return next;
  const stopped = die.name.kind === 'status-check';
  const needsHit = (entry: ForcedDie): boolean => needsHitOn(entry.name, die.name) || (isLaterHit(entry.name) && sameTarget(entry.name, die.name));
  return next.filter(entry => !((NEEDS_HIT.has(entry.name.kind) || isLaterHit(entry.name)) && sameMove(entry.name, die.name) && (stopped || needsHit(entry))));
}

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

/** Folds later hits of a move and target into one count die ("Triple Axel: 2 hits"); a cut-short count: `blocked`. */
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
      took: !failed ? 'applied' : group.some(held => held.took === 'applied') ? 'blocked' : failed.took,
      ...(failed?.reason !== undefined ? { reason: failed.reason } : {}),
      ...(failed?.landed !== undefined && failed.landed > 0 ? { landed: failed.landed } : {}),
      ...(logged.length > 0 ? { logIndex: Math.min(...logged) } : {}),
    }];
  });
}
