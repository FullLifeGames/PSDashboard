import type { Battle } from '@pkmn/sim';
import { killCount, rollValue, type KillTable } from './kill-table.ts';
import { hpAfterHit, movesLater, randomDeviation } from './log.ts';
import type { AccuracyRecord, CritRecord, PairRecord, PairScript, RollRecord } from './prng.ts';
import type { HitSnapshot } from './snapshot.ts';

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
 */

export type PairOutcome = 'miss' | 'hit' | 'hit-kill' | 'hit-nokill';

export interface Alternative {
  outcome: PairOutcome;
  probability: number;
  script: PairScript;
}

export interface PairEvent {
  /** `${attackerSlot}:${moveId}>${targetSlot}` */
  key: string;
  outcome: PairOutcome;
  /** Probability of the drawn outcome. */
  probability: number;
  /** The other outcomes, with their probability and the script that asks for them. */
  alternatives: Alternative[];
}

export type Pattern = { kind: 'pattern'; key: string; weight: number; events: PairEvent[] };
export type PatternRead = Pattern | { kind: 'fallback'; reason: string };
export type TableFor = (snapshot: HitSnapshot) => KillTable | null;

type Dex = Battle['dex'];
type Read = PairEvent | null | { fallback: string };

interface Hit { key: string; accuracy?: AccuracyRecord; crit?: CritRecord; rolls: RollRecord[] }
interface KillOdds { pKill: number; killed: boolean; table: KillTable | null }

const FLINCH_ITEMS = new Set(['kingsrock', 'razorfang']);
const FLINCH_PROOF = new Set(['innerfocus', 'shielddust']);

const targetOf = (key: string) => key.slice(key.indexOf('>') + 1);

/** The hit instances in the order the sim first rolled for them. */
function hitsOf(records: readonly PairRecord[]): Hit[] {
  const byInstance = new Map<number, Hit>();
  for (const record of records) {
    if (record.kind === 'tie') continue;
    let hit = byInstance.get(record.instance);
    if (!hit) {
      hit = { key: record.key, rolls: [] };
      byInstance.set(record.instance, hit);
    }
    if (record.kind === 'accuracy') hit.accuracy = record;
    else if (record.kind === 'crit') hit.crit = record;
    else hit.rolls.push(record);
  }
  return [...byInstance.values()];
}

/** A landed hit whose move can make a target that has not moved yet flinch (spec rule F3). */
function flinchChance(dex: Dex, roll: RollRecord, log: readonly string[]): boolean {
  const { attacker, defender, moveId } = roll.snapshot;
  if (FLINCH_PROOF.has(defender.abilityId) || defender.itemId === 'covertcloak') return false;
  const secondaries = dex.moves.get(moveId).secondaries ?? [];
  const flinches = FLINCH_ITEMS.has(attacker.itemId) || attacker.abilityId === 'stench' ||
    secondaries.some(secondary => secondary.volatileStatus === 'flinch' && (secondary.chance ?? 100) < 100);
  return flinches && movesLater(log, roll.logIndex, targetOf(roll.key));
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

const killShare = (table: KillTable, hp: number, crit: number) =>
  (1 - crit) * killCount(table.normal, hp) / 16 + crit * killCount(table.crit, hp) / 16;

/** The kill odds of a landed roll, the calc checked against the damage the log shows (spec rules C, D, F6). */
function killOdds(hit: Hit, roll: RollRecord, log: readonly string[], tableFor: TableFor): KillOdds | { fallback: string } {
  const before = roll.snapshot.defender.hp;
  const after = hpAfterHit(log, roll.logIndex, targetOf(hit.key), roll.snapshot.defender.maxhp);
  if (after === null) return { fallback: 'no-damage-line' };
  const killed = after === 0;
  if (!killed && surelyNonLethal(before - after, roll)) return { pKill: 0, killed, table: null };
  const table = tableFor(roll.snapshot);
  if (!table) return { fallback: 'no-table' };
  const value = rollValue(table, roll.roll, roll.crit);
  if (killed ? value < before : value !== before - after) return { fallback: 'calc-mismatch' };
  const pKill = killShare(table, before, critChance(hit, roll));
  if ((killed && pKill === 0) || (!killed && pKill === 1)) return { fallback: 'calc-mismatch' };
  return { pKill, killed, table };
}

/** The script for the kill class: the median killing normal roll, a crit only where no normal roll kills. */
function killScript(table: KillTable, hp: number): PairScript {
  const normal = killCount(table.normal, hp);
  if (normal > 0) return { hit: true, crit: false, roll: Math.floor((normal - 1) / 2) };
  return { hit: true, crit: true, roll: Math.floor((killCount(table.crit, hp) - 1) / 2) };
}

/** The script for the no-kill class: the median non-killing normal roll. */
function noKillScript(table: KillTable, hp: number): PairScript {
  const normal = killCount(table.normal, hp);
  return { hit: true, crit: false, roll: normal + Math.floor((16 - normal - 1) / 2) };
}

/** A table's hit outcomes as alternatives, the drawn one left out. */
function hitAlternatives(pHit: number, pKill: number, table: KillTable, hp: number, drawn: PairOutcome): Alternative[] {
  const out: Alternative[] = [];
  if (pKill > 0 && drawn !== 'hit-kill') out.push({ outcome: 'hit-kill', probability: pHit * pKill, script: killScript(table, hp) });
  if (pKill < 1 && drawn !== 'hit-nokill' && killCount(table.normal, hp) < 16) {
    out.push({ outcome: 'hit-nokill', probability: pHit * (1 - pKill), script: noKillScript(table, hp) });
  }
  return out;
}

/** A missed roll: its alternatives are the hit classes from the table of the accuracy snapshot (checked when a flip draws them). */
function missRead(dex: Dex, hit: Hit, pHit: number, tableFor: TableFor): PairEvent {
  const snap = hit.accuracy?.snapshot ?? null;
  const damaging = !!snap && dex.moves.get(snap.moveId).category !== 'Status';
  const table = snap && damaging ? tableFor(snap) : null;
  const alternatives = snap && table
    ? hitAlternatives(pHit, killShare(table, snap.defender.hp, missedCrit(dex, snap)), table, snap.defender.hp, 'miss')
    : [{ outcome: 'hit' as const, probability: pHit, script: { hit: true } }];
  return { key: hit.key, outcome: 'miss', probability: 1 - pHit, alternatives };
}

/** A landed hit: its kill odds, or no event where hit and kill are both certain. */
function hitRead(hit: Hit, pHit: number, log: readonly string[], tableFor: TableFor): Read {
  const roll = hit.rolls[0];
  const missAlternative: Alternative[] = pHit < 1 ? [{ outcome: 'miss', probability: 1 - pHit, script: { hit: false } }] : [];
  if (!roll) return pHit < 1 ? { key: hit.key, outcome: 'hit', probability: pHit, alternatives: missAlternative } : null;
  const odds = killOdds(hit, roll, log, tableFor);
  if ('fallback' in odds) return odds;
  if (pHit >= 1 && (odds.pKill === 0 || odds.pKill === 1)) return null;
  const outcome: PairOutcome = odds.killed ? 'hit-kill' : 'hit-nokill';
  const hp = roll.snapshot.defender.hp;
  return {
    key: hit.key,
    outcome,
    probability: pHit * (odds.killed ? odds.pKill : 1 - odds.pKill),
    alternatives: odds.table ? [...missAlternative, ...hitAlternatives(pHit, odds.pKill, odds.table, hp, outcome)] : missAlternative,
  };
}

function readHit(dex: Dex, hit: Hit, log: readonly string[], tableFor: TableFor): Read {
  if (hit.rolls.length > 1) return { fallback: 'multi-roll' };
  const roll = hit.rolls[0];
  if (roll?.snapshot.shielded) return { fallback: `shielded:${roll.snapshot.shielded}` };
  if (roll && flinchChance(dex, roll, log)) return { fallback: 'flinch-chance' };
  const pHit = hit.accuracy ? Math.min(1, hit.accuracy.numerator / 100) : 1;
  if (hit.accuracy && !hit.accuracy.hit) return missRead(dex, hit, pHit, tableFor);
  return hitRead(hit, pHit, log, tableFor);
}

export function readPattern(records: readonly PairRecord[], log: readonly string[], dex: Dex, tableFor: TableFor): PatternRead {
  if (records.some(record => record.kind === 'tie')) return { kind: 'fallback', reason: 'tie' };
  const deviation = randomDeviation(log);
  if (deviation) return { kind: 'fallback', reason: deviation };
  const events: PairEvent[] = [];
  for (const hit of hitsOf(records)) {
    const read = readHit(dex, hit, log, tableFor);
    if (read && 'fallback' in read) return { kind: 'fallback', reason: read.fallback };
    if (read) events.push(read);
  }
  return {
    kind: 'pattern',
    key: events.map(event => `${event.key}=${event.outcome}`).join('|'),
    weight: events.reduce((product, event) => product * event.probability, 1),
    events,
  };
}
