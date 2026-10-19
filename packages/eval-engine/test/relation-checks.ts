import { readFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { advancePosition, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { createMatchupCache, evaluatePosition, type StaticRuleset } from '../src/eval-function';

/**
 * Round 72 (T240): the relation checks on search-made leaves. A relation is a
 * statement about the static score that holds on any board, whatever the
 * search built: own HP down never raises it, foe HP down never lowers it, a
 * stage on a body that cannot act adds nothing, and swapped sides negate.
 * Each check takes the evaluator as an argument, so a test can plant a fault
 * in an evaluator and prove the check can fail.
 */

export type RelationGroup = 'singles' | 'doublesou' | 'vgc' | 'champions';

export interface ManifestEntry {
  file: string;
  id: string;
  turn: number;
  gameType: 'singles' | 'doubles';
  group: RelationGroup;
  ruleset: StaticRuleset;
  reason: string;
}

export interface RelationSubject extends ManifestEntry {
  /** 'root' for the fixture's own position, else the pair of choices that made the leaf. */
  kind: 'root' | 'leaf';
  label: string;
  serialized: string;
}

export type Evaluator = (battle: Battle, ruleset: StaticRuleset) => number;

export interface Violation {
  relation: 'ownHpDown' | 'foeHpDown' | 'idleStage' | 'swapNegates';
  subject: string;
  detail: string;
  /** The size of the break in score units. */
  size: number;
  /** The body that changed: its side, its index in side.pokemon and the HP before and after (HP series only). */
  body?: { side: 0 | 1; index: number; fromHp: number; toHp: number };
}

/** The tolerance of every relation: the residuals are floating-point noise (largest measured on the roots: 1.7e-16). */
export const TOLERANCE = 1e-9;

/** The static evaluation the engine ships, with a fresh matchup cache per call. */
export const realEvaluator: Evaluator = (battle, ruleset) => evaluatePosition(battle, createMatchupCache(ruleset));

const FIXTURES = new URL('./fixtures/', import.meta.url);

export const readManifest = (): ManifestEntry[] =>
  (JSON.parse(readFileSync(new URL('relation-positions/manifest.json', FIXTURES), 'utf-8')) as { positions: ManifestEntry[] }).positions;

export const readSerialized = (entry: ManifestEntry): string =>
  (JSON.parse(readFileSync(new URL(entry.file, FIXTURES), 'utf-8')) as { serialized: string }).serialized;

/** A fresh deserialization the caller may change (positionBattle of a new root; the cached battle of a position is read-only). */
export const reviveBattle = (serialized: string, ruleset: StaticRuleset): Battle =>
  positionBattle(createRootPosition(serialized, ruleset));

/**
 * The same battle with the two sides exchanged: p1's side becomes p2's, with its index and id. The helper changes
 * the revived battle in place and swaps back on a second call.
 */
export function swapSides(battle: Battle): Battle {
  const [first, second] = battle.sides;
  const sides = battle.sides as unknown as Battle['sides'] & { [i: number]: typeof first };
  sides[0] = second;
  sides[1] = first;
  for (const [index, side] of battle.sides.entries()) {
    side.n = index;
    side.id = (['p1', 'p2'] as const)[index];
  }
  first.foe = second;
  second.foe = first;
  return battle;
}

/** The first, the middle and the last of a list, or all of it when it holds three or fewer. */
export function pickByStride<T>(items: readonly T[], count = 3): T[] {
  if (items.length <= count) return [...items];
  const picks = new Set<number>();
  for (let i = 0; i < count; i++) picks.add(Math.round((i * (items.length - 1)) / (count - 1)));
  return [...picks].map(index => items[index]);
}

export const SWEEP_SEED = [1, 2, 3, 4] as const;

export interface SweepResult {
  leaves: RelationSubject[];
  /** Pairs whose advance ended the battle: the score is then +1, 0 or -1 and no relation reads them. */
  ended: number;
}

/**
 * The one-ply sweep: three legal choices per side picked by stride, every pair advanced under the fixed seed. A
 * root without a choice for a side (a request that waits) has no leaves.
 */
export function sweepLeaves(root: RelationSubject, perSide = 3): SweepResult {
  const position = createRootPosition(root.serialized, root.ruleset);
  const p1 = pickByStride(legalChoices(position, 'p1'), perSide);
  const p2 = pickByStride(legalChoices(position, 'p2'), perSide);
  const leaves: RelationSubject[] = [];
  let ended = 0;
  if (p1.some(option => option.choice === 'wait') || p2.some(option => option.choice === 'wait')) return { leaves, ended };
  for (const a of p1) {
    for (const b of p2) {
      const child = advancePosition(position, a.choice, b.choice, [...SWEEP_SEED]);
      if (positionBattle(child).ended) {
        ended++;
        continue;
      }
      leaves.push({ ...root, kind: 'leaf', label: `${root.id}-t${root.turn} ${a.choice} | ${b.choice}`, serialized: child.serialized });
    }
  }
  return { leaves, ended };
}

export const rootSubject = (entry: ManifestEntry): RelationSubject => ({
  ...entry, kind: 'root', label: `${entry.id}-t${entry.turn}`, serialized: readSerialized(entry),
});

const HP_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] as const;

/** The labels of the bodies on a side that can take damage: the ones still standing. */
const standing = (battle: Battle, side: 0 | 1) => battle.sides[side].pokemon.filter(mon => mon.hp > 0);

/**
 * HP of one side goes down body by body (the active ones and the bench): 90 down to 10 % of the maximum in steps of 10, the
 * steps below the body's current HP only. `worse` names the direction a step must not break.
 */
function hpSeriesViolations(
  subject: RelationSubject, evaluate: Evaluator, side: 0 | 1, relation: 'ownHpDown' | 'foeHpDown',
): Violation[] {
  const battle = reviveBattle(subject.serialized, subject.ruleset);
  const violations: Violation[] = [];
  for (const [index, mon] of battle.sides[side].pokemon.entries()) {
    if (mon.hp <= 0) continue;
    const start = mon.hp;
    let previous = evaluate(battle, subject.ruleset);
    let previousHp = start;
    try {
      for (const step of HP_STEPS) {
        const hp = Math.max(1, Math.round(mon.maxhp * step));
        if (hp >= previousHp) continue;
        mon.hp = hp;
        const score = evaluate(battle, subject.ruleset);
        // Own HP down must not raise the score; foe HP down must not lower it (p1's view).
        const delta = side === 0 ? score - previous : previous - score;
        if (delta > TOLERANCE) {
          violations.push({
            relation, subject: subject.label, size: delta, body: { side, index, fromHp: previousHp, toHp: hp },
            detail: `${side === 0 ? 'p1' : 'p2'} body ${index} (${mon.species.name}) ${previousHp}/${mon.maxhp} to ${hp}/${mon.maxhp}: ${previous.toFixed(6)} to ${score.toFixed(6)}`,
          });
        }
        previous = score;
        previousHp = hp;
      }
    } finally {
      mon.hp = start;
    }
  }
  return violations;
}

/** R1: a p1 body with less HP never makes p1's score higher. */
export const ownHpDown = (subject: RelationSubject, evaluate: Evaluator): Violation[] =>
  hpSeriesViolations(subject, evaluate, 0, 'ownHpDown');

/** R2: a p2 body with less HP never makes p1's score lower (the r69 monotony probe, T199 in VGC). */
export const foeHpDown = (subject: RelationSubject, evaluate: Evaluator): Violation[] =>
  hpSeriesViolations(subject, evaluate, 1, 'foeHpDown');

/** The stages the relation gives a fainted body: attack, special attack and speed at +2. */
const IDLE_BOOSTS = { atk: 2, spa: 2, spe: 2 } as const;

/** R3: a fainted body (it cannot act) carrying stages leaves the score as it was. */
export function idleStage(subject: RelationSubject, evaluate: Evaluator): Violation[] {
  const battle = reviveBattle(subject.serialized, subject.ruleset);
  const base = evaluate(battle, subject.ruleset);
  const violations: Violation[] = [];
  for (const side of [0, 1] as const) {
    for (const [index, mon] of battle.sides[side].pokemon.entries()) {
      if (mon.hp > 0) continue;
      const saved = { ...mon.boosts };
      try {
        Object.assign(mon.boosts, IDLE_BOOSTS);
        const score = evaluate(battle, subject.ruleset);
        if (Math.abs(score - base) > TOLERANCE) {
          violations.push({
            relation: 'idleStage', subject: subject.label, size: Math.abs(score - base),
            detail: `${side === 0 ? 'p1' : 'p2'} fainted body ${index} (${mon.species.name}) with +2 atk, spa, spe: ${base.toFixed(6)} to ${score.toFixed(6)}`,
          });
        }
      } finally {
        Object.assign(mon.boosts, saved);
      }
    }
  }
  return violations;
}

/** R4: the same board with the sides exchanged scores the negative. */
export function swapNegates(subject: RelationSubject, evaluate: Evaluator): Violation[] {
  const original = evaluate(reviveBattle(subject.serialized, subject.ruleset), subject.ruleset);
  const swapped = evaluate(swapSides(reviveBattle(subject.serialized, subject.ruleset)), subject.ruleset);
  const residual = Math.abs(original + swapped);
  return residual > TOLERANCE
    ? [{ relation: 'swapNegates', subject: subject.label, size: residual, detail: `score ${original.toFixed(6)}, swapped ${swapped.toFixed(6)}` }]
    : [];
}

export const RELATIONS = { ownHpDown, foeHpDown, idleStage, swapNegates } as const;
export type RelationName = keyof typeof RELATIONS;

/** Counts the standing bodies of a side (the manifest guard reads it). */
export const standingCount = (battle: Battle, side: 0 | 1): number => standing(battle, side).length;
