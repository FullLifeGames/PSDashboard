import type { Battle } from '@pkmn/sim';
import { strengthMix, type StrengthMix } from '../calc/fickle.ts';
import { killCount, killShare, rollValue, type KillTable, type PricedHit } from './kill-table.ts';
import { actsLater, hpAfterHit, randomDeviation } from './log.ts';
import type { AccuracyRecord, CritRecord, PairRecord, PairScript, RollRecord, SecondaryRecord } from './prng.ts';
import type { HitSnapshot } from './snapshot.ts';
import { hitClasses, truncates, type EventSecondary } from '../search/secondary-classes.ts';

/**
 * Round 56: one draw read as a class of the doubles pair plan. Every hit
 * instance the dice wrote down gets its outcome (miss, hit, hit-kill,
 * hit-nokill) and that outcome's probability: the hit threshold the sim
 * used, the crit chance it rolled with, and the share of the 16 damage
 * rolls that kill — from the calc, trusted only where it reproduces the
 * drawn roll's damage to the HP. An instance whose outcome is not certain
 * is an event; the class key is the sequence of events, its weight the
 * product of their probabilities. Order, truncation, retargeting and
 * redirection are whatever the sim did in the draw. What the plan does not
 * price makes the read a fallback (spec rules F2 to F6).
 *
 * Round 86 (T305): the secondary dice of a hit are part of its class. The recorded dice (the effect, its chance, the result) name
 * the effects that came true, the class key appends them (`p1a:rockslide>p2a=hit-nokill+flinch`), and the other results of the
 * dice are alternatives with the script that asks for them. A flinch is priced only where the target has not moved yet.
 */

export type PairOutcome = 'miss' | 'hit' | 'hit-kill' | 'hit-nokill';

export interface Alternative {
  outcome: PairOutcome;
  /** The effects that came true in the class (a hit that does not kill; sorted). */
  tokens?: string[];
  probability: number;
  script: PairScript;
}

export interface PairEvent {
  /** `${attackerSlot}:${moveId}>${targetSlot}` */
  key: string;
  outcome: PairOutcome;
  /** The effects whose die came true on the drawn hit (sorted); empty for a miss, a kill and a hit without a die. */
  tokens: string[];
  /** Probability of the drawn outcome. */
  probability: number;
  /** The other outcomes, with their probability and the script that asks for them. */
  alternatives: Alternative[];
}

export type Pattern = { kind: 'pattern'; key: string; weight: number; events: PairEvent[] };
export type PatternRead = Pattern | { kind: 'fallback'; reason: string };
export type TableFor = (snapshot: PricedHit) => KillTable | null;
/** The entries a hit's move would draw (a missed hit and a kill record none); null when the simulator refuses the question. */
export type EntriesFor = (hitKey: string) => readonly EventSecondary[] | null;

type Dex = Battle['dex'];
type Read = PairEvent | null | { fallback: string };

interface Hit { key: string; accuracy?: AccuracyRecord; crit?: CritRecord; rolls: RollRecord[]; dice: SecondaryRecord[] }
/** A hit's tables: its one table, or for a move that doubles on a chance (Fickle Beam, T154) the table at each strength. */
interface Priced { weak: KillTable; strong: KillTable | null; mix: StrengthMix | null }
interface KillOdds { pKill: number; killed: boolean; priced: Priced | null }

const targetOf = (key: string) => key.slice(key.indexOf('>') + 1);

/** The hit instances in the order the sim first rolled for them. */
function hitsOf(records: readonly PairRecord[]): Hit[] {
  const byInstance = new Map<number, Hit>();
  for (const record of records) {
    if (record.kind === 'tie') continue;
    let hit = byInstance.get(record.instance);
    if (!hit) {
      hit = { key: record.key, rolls: [], dice: [] };
      byInstance.set(record.instance, hit);
    }
    if (record.kind === 'accuracy') hit.accuracy = record;
    else if (record.kind === 'crit') hit.crit = record;
    else if (record.kind === 'secondary') hit.dice.push(record);
    else hit.rolls.push(record);
  }
  return [...byInstance.values()];
}

/**
 * The entries a hit's dice decide: the recorded dice when the hit drew some, else the read of the move's entries (a missed hit and a
 * kill draw none the plan can see). An effect that stops a target that has not moved yet counts only when the target moves later.
 */
function effectsOf(dex: Dex, hit: Hit, log: readonly string[], entriesFor: EntriesFor | undefined): EventSecondary[] | { fallback: string } {
  const recorded: EventSecondary[] = hit.dice.map(die => ({ effectId: die.effectId, chance: die.chance, truncates: truncates(dex, die.effectId) }));
  const entries = recorded.length > 0 || !entriesFor ? recorded : entriesFor(hit.key);
  if (entries === null) return { fallback: 'secondary-read' };
  const later = actsLater(log, hit.rolls[0]?.logIndex ?? hit.accuracy?.logIndex ?? 0, targetOf(hit.key));
  return entries.filter(entry => entry.chance < 1 && (!entry.truncates || later));
}

/** The effects of a landed hit that came true, by the recorded dice (sorted, once each). */
const cameOf = (hit: Hit, effects: readonly EventSecondary[]): string[] =>
  [...new Set(effects.filter(entry => hit.dice.some(die => die.happened && die.effectId === entry.effectId)).map(entry => entry.effectId))].sort();

/** The hit-nokill classes of the effects other than the drawn one, with the script that asks for each (`base` carries the hit, roll and crit). */
function tokenAlternatives(pNoKill: number, effects: readonly EventSecondary[], drawn: readonly string[] | null, base: PairScript): Alternative[] {
  return hitClasses(effects).filter(cls => !drawn || cls.tokens.join('+') !== drawn.join('+')).map(cls => ({
    outcome: 'hit-nokill' as const,
    tokens: cls.tokens,
    probability: pNoKill * cls.weight,
    script: effects.length === 0 ? base : { ...base, secondary: Object.fromEntries(effects.map(entry => [entry.effectId, cls.tokens.includes(entry.effectId)])) },
  }));
}

/** The crit chance of a roll: the rolled denominator, none against a blocked crit, the drawn crit where nothing was rolled. */
function critChance(hit: Hit, roll: RollRecord): number {
  if (roll.snapshot.critBlocked) return 0;
  if (hit.crit) return 1 / hit.crit.denominator;
  return roll.crit ? 1 : 0;
}

/** The crit chance of a hit that never came (a miss): the move's crit stage, approximated. */
function missedCrit(dex: Dex, snap: HitSnapshot): number {
  if (snap.critBlocked) return 0;
  const move = dex.moves.get(snap.moveId);
  if (move.willCrit) return 1;
  if ((move.critRatio ?? 1) >= 2) return 1 / 8;
  return snap.gen >= 7 ? 1 / 24 : 1 / 16;
}

/** A crit ignores the attacker's offensive drops, the defender's defensive raises and the screens. */
function critIgnoresModifiers({ attacker, defender, screens }: HitSnapshot): boolean {
  return attacker.boosts.atk < 0 || attacker.boosts.spa < 0 || defender.boosts.def > 0 || defender.boosts.spd > 0 || screens.length > 0;
}

/**
 * No roll, not even the top roll as a crit, could reach the HP: scaled up
 * from the drawn damage, with 3 % and 2 HP of margin. A drawn normal roll
 * under a modifier a crit ignores bounds nothing (final review of round
 * 56: the crit of an Intimidated attacker does 2.25 times the hit or more).
 */
function surelyNonLethal(damage: number, roll: RollRecord): boolean {
  if (!roll.crit && critIgnoresModifiers(roll.snapshot)) return false;
  const { gen, attacker, defender } = roll.snapshot;
  const critFactor = (gen >= 6 ? 1.5 : 2) * (attacker.abilityId === 'sniper' ? 1.5 : 1);
  const top = damage * 100 / (100 - roll.roll) * (roll.crit ? 1 : critFactor);
  return top * 1.03 + 2 < defender.hp;
}

/** The tables of a hit at the strengths its move can draw; null when one of them cannot be priced. */
function priceHit(snapshot: PricedHit, dex: Dex, tableFor: TableFor): Priced | null {
  const bare: PricedHit = { ...snapshot };
  delete bare.strength;
  const weak = tableFor(bare);
  const mix = strengthMix(dex, snapshot.moveName);
  const strong = mix && weak ? tableFor({ ...bare, strength: mix.factor }) : null;
  return weak && (!mix || strong) ? { weak, strong, mix } : null;
}

/** The table of the strength the roll drew. */
const drawnTable = (priced: Priced, snapshot: PricedHit): KillTable =>
  priced.strong && priced.mix && snapshot.strength === priced.mix.factor ? priced.strong : priced.weak;

const pricedShare = (priced: Priced, hp: number, crit: number): number =>
  priced.strong && priced.mix
    ? (1 - priced.mix.chance) * killShare(priced.weak, hp, crit) + priced.mix.chance * killShare(priced.strong, hp, crit)
    : killShare(priced.weak, hp, crit);

/** The kill odds of a landed roll, the calc checked against the damage the log shows (spec rules C, D, F6). */
function killOdds(hit: Hit, roll: RollRecord, log: readonly string[], dex: Dex, tableFor: TableFor): KillOdds | { fallback: string } {
  const before = roll.snapshot.defender.hp;
  const after = hpAfterHit(log, roll.logIndex, targetOf(hit.key), roll.snapshot.defender.maxhp);
  if (after === null) return { fallback: 'no-damage-line' };
  const killed = after === 0;
  // The bound on the drawn damage says nothing about the other strength of a move that doubles on a chance.
  if (!killed && !strengthMix(dex, roll.snapshot.moveName) && surelyNonLethal(before - after, roll)) return { pKill: 0, killed, priced: null };
  const priced = priceHit(roll.snapshot, dex, tableFor);
  if (!priced) return { fallback: 'no-table' };
  const value = rollValue(drawnTable(priced, roll.snapshot), roll.roll, roll.crit);
  if (killed ? value < before : value !== before - after) return { fallback: 'calc-mismatch' };
  const pKill = pricedShare(priced, before, critChance(hit, roll));
  if ((killed && pKill === 0) || (!killed && pKill === 1)) return { fallback: 'calc-mismatch' };
  return { pKill, killed, priced };
}

/** The strengths a script can ask for: the weaker one first, the stronger one only for a move that doubles on a chance. */
function strengthsOf(priced: Priced): { table: KillTable; doubled?: boolean }[] {
  return priced.strong ? [{ table: priced.weak, doubled: false }, { table: priced.strong, doubled: true }] : [{ table: priced.weak }];
}

const strengthScript = (strength: { doubled?: boolean }): { doubled?: boolean } => (strength.doubled === undefined ? {} : { doubled: strength.doubled });

/** The script for the kill class: the median killing normal roll (at the first strength that has one), a crit only where no normal roll kills. */
function killScript(priced: Priced, hp: number): PairScript {
  const strengths = strengthsOf(priced);
  const byNormal = strengths.find(({ table }) => killCount(table.normal, hp) > 0);
  if (byNormal) return { hit: true, crit: false, roll: Math.floor((killCount(byNormal.table.normal, hp) - 1) / 2), ...strengthScript(byNormal) };
  const byCrit = strengths.find(({ table }) => killCount(table.crit, hp) > 0) ?? strengths[0];
  return { hit: true, crit: true, roll: Math.floor((killCount(byCrit.table.crit, hp) - 1) / 2), ...strengthScript(byCrit) };
}

/** The script for the no-kill class: the median non-killing normal roll, at the weaker strength. */
function noKillScript(priced: Priced, hp: number): PairScript {
  const normal = killCount(priced.weak.normal, hp);
  return { hit: true, crit: false, roll: normal + Math.floor((16 - normal - 1) / 2), ...(priced.strong ? { doubled: false } : {}) };
}

/** A hit's outcomes as alternatives, the drawn one left out; the classes of the hit's dice split the no-kill outcome. */
function hitAlternatives(
  pHit: number, pKill: number, priced: Priced, hp: number, drawn: PairOutcome, effects: readonly EventSecondary[] = [], tokens: readonly string[] = [],
): Alternative[] {
  const out: Alternative[] = [];
  if (pKill > 0 && drawn !== 'hit-kill') out.push({ outcome: 'hit-kill', probability: pHit * pKill, script: killScript(priced, hp) });
  const noKill = drawn === 'hit-nokill';
  if (pKill < 1 && (noKill || killCount(priced.weak.normal, hp) < 16)) {
    out.push(...tokenAlternatives(pHit * (1 - pKill), effects, noKill ? tokens : null, noKill ? {} : noKillScript(priced, hp)));
  }
  return out;
}

/** A missed roll: its alternatives are the hit classes from the table of the accuracy snapshot (checked when a flip draws them). */
function missRead(dex: Dex, hit: Hit, pHit: number, tableFor: TableFor, effects: readonly EventSecondary[]): PairEvent {
  const snap = hit.accuracy?.snapshot ?? null;
  const damaging = !!snap && dex.moves.get(snap.moveId).category !== 'Status';
  const priced = snap && damaging ? priceHit(snap, dex, tableFor) : null;
  const alternatives = snap && priced
    ? hitAlternatives(pHit, pricedShare(priced, snap.defender.hp, missedCrit(dex, snap)), priced, snap.defender.hp, 'miss', effects)
    : [{ outcome: 'hit' as const, probability: pHit, script: { hit: true } }];
  return { key: hit.key, outcome: 'miss', tokens: [], probability: 1 - pHit, alternatives };
}

/** A landed hit: its kill odds, or no event where hit and kill are both certain. */
function hitRead(hit: Hit, pHit: number, log: readonly string[], dex: Dex, tableFor: TableFor, entriesFor?: EntriesFor): Read {
  const roll = hit.rolls[0];
  const missAlternative: Alternative[] = pHit < 1 ? [{ outcome: 'miss', probability: 1 - pHit, script: { hit: false } }] : [];
  if (!roll) return pHit < 1 ? { key: hit.key, outcome: 'hit', tokens: [], probability: pHit, alternatives: missAlternative } : null;
  const odds = killOdds(hit, roll, log, dex, tableFor);
  if ('fallback' in odds) return odds;
  const effects = effectsOf(dex, hit, log, entriesFor);
  if ('fallback' in effects) return effects;
  // a landed hit that does not kill draws its dice; none recorded for an effect the read names is a read the plan cannot trust
  if (!odds.killed && effects.length > 0 && hit.dice.length === 0) return { fallback: 'secondary-unread' };
  if (pHit >= 1 && (odds.pKill === 1 || (odds.pKill === 0 && effects.length === 0))) return null;
  return landedRead(hit, roll, pHit, odds, effects, missAlternative);
}

/** A landed hit's event: its class (the effects that came true), its probability and the other classes as alternatives. */
function landedRead(hit: Hit, roll: RollRecord, pHit: number, odds: KillOdds, effects: readonly EventSecondary[], missAlternative: Alternative[]): Read {
  const outcome: PairOutcome = odds.killed ? 'hit-kill' : 'hit-nokill';
  const tokens = odds.killed ? [] : cameOf(hit, effects);
  const share = hitClasses(effects).find(cls => cls.tokens.join('+') === tokens.join('+'))?.weight;
  if (share === undefined) return { fallback: 'secondary-class' };
  const hp = roll.snapshot.defender.hp;
  return {
    key: hit.key,
    outcome,
    tokens,
    probability: pHit * (odds.killed ? odds.pKill : (1 - odds.pKill) * share),
    alternatives: odds.priced
      ? [...missAlternative, ...hitAlternatives(pHit, odds.pKill, odds.priced, hp, outcome, effects, tokens)]
      : [...missAlternative, ...(outcome === 'hit-nokill' ? tokenAlternatives(pHit, effects, tokens, {}) : [])],
  };
}

function readHit(dex: Dex, hit: Hit, log: readonly string[], tableFor: TableFor, entriesFor?: EntriesFor): Read {
  if (hit.rolls.length > 1) return { fallback: 'multi-roll' };
  const roll = hit.rolls[0];
  if (roll?.snapshot.shielded) return { fallback: `shielded:${roll.snapshot.shielded}` };
  const pHit = hit.accuracy ? Math.min(1, hit.accuracy.numerator / 100) : 1;
  if (hit.accuracy && !hit.accuracy.hit) {
    const effects = effectsOf(dex, hit, log, entriesFor);
    return 'fallback' in effects ? effects : missRead(dex, hit, pHit, tableFor, effects);
  }
  return hitRead(hit, pHit, log, dex, tableFor, entriesFor);
}

/** The `<slot>|<effect id>` pairs a recorded die explains: a stopping effect that came true on a target (its |cant| line is no deviation). */
const explainedCants = (hits: readonly Hit[], dex: Dex): Set<string> =>
  new Set(hits.flatMap(hit => hit.dice.filter(die => die.happened && truncates(dex, die.effectId)).map(die => `${targetOf(hit.key)}|${die.effectId}`)));

export function readPattern(records: readonly PairRecord[], log: readonly string[], dex: Dex, tableFor: TableFor, entriesFor?: EntriesFor): PatternRead {
  if (records.some(record => record.kind === 'tie')) return { kind: 'fallback', reason: 'tie' };
  const hits = hitsOf(records);
  const deviation = randomDeviation(log, explainedCants(hits, dex));
  if (deviation) return { kind: 'fallback', reason: deviation };
  const events: PairEvent[] = [];
  for (const hit of hits) {
    const read = readHit(dex, hit, log, tableFor, entriesFor);
    if (read && 'fallback' in read) return { kind: 'fallback', reason: read.fallback };
    if (read) events.push(read);
  }
  return {
    kind: 'pattern',
    key: events.map(event => `${event.key}=${event.outcome}${event.tokens.map(token => `+${token}`).join('')}`).join('|'),
    weight: events.reduce((product, event) => product * event.probability, 1),
    events,
  };
}
