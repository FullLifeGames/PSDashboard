import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type BranchSlotChoice, type ForcedDie } from '@fulllifegames/eval-engine';
import { computePreviewDamage } from '../../../src/lib/branch-damage';
import { rollsFor } from '../../../src/lib/branch-rolls';
import { diceBattle, setOf } from '../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7a: the damage preview of the panel with forced dice. The move a slot has chosen lists the damage
 * of each step of the roll, and a forced crit prices that move (on that target) as a crit. Other moves keep the plain preview.
 */
type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

function preview(battle: Battle, choices: Picks) {
  const state = createBranchStateFromBattle(battle as never, [], { p1Choices: choices.p1, p2Choices: choices.p2 });
  const damage = computePreviewDamage({
    p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
    p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
    fieldState: state.field, gen: battle.gen, choices,
  } as Parameters<typeof computePreviewDamage>[0], calcSingleDamageRange);
  return { state, damage };
}

const crit = (slot: string, moveId: string, targetSlot: string, happens = true): ForcedDie => ({ name: { slot, moveId, targetSlot, kind: 'crit' }, result: { happens } });
const move = (moveId: string, moveName: string, extra: Partial<BranchSlotChoice> = {}) => ({ kind: 'move', moveId, moveName, ...extra }) as BranchSlotChoice;

const singles = () => diceBattle({ p1: [setOf('Noivern', ['airslash', 'tackle'])], p2: [setOf('Snorlax', ['splash'])] });

describe('the damage preview with forced dice', () => {
  test('the chosen move lists the steps of its roll, the other moves do not', () => {
    const { damage } = preview(singles(), { p1: [move('airslash', 'Air Slash')], p2: [] });
    const [chosen, other] = damage.p1.default[0];
    expect(chosen.rolls?.damage).toHaveLength(16);
    expect(other.rolls).toBeUndefined();
    const sorted = [...chosen.rolls!.damage].sort((a, b) => a - b);
    expect(chosen.rolls!.damage).toEqual(sorted);
  });

  test('a forced crit prices the chosen move as a crit and no other move', () => {
    const plain = preview(singles(), { p1: [move('airslash', 'Air Slash')], p2: [] }).damage.p1.default[0];
    const forced = preview(singles(), { p1: [move('airslash', 'Air Slash', { dice: [crit('p1a', 'airslash', 'p2a')] })], p2: [] }).damage.p1.default[0];
    expect(forced[0].maxPercent).toBeGreaterThan(plain[0].maxPercent);
    expect(forced[0].rolls!.damage[15]).toBeGreaterThan(plain[0].rolls!.damage[15]);
    expect(forced[1]).toEqual(plain[1]);
    const noCrit = preview(singles(), { p1: [move('airslash', 'Air Slash', { dice: [crit('p1a', 'airslash', 'p2a', false)] })], p2: [] }).damage.p1.default[0];
    expect(noCrit[0]).toEqual(plain[0]);
  });

  test('a forced hit count prices a multi-hit move for that count', () => {
    const battle = diceBattle({ p1: [setOf('Noivern', ['furyattack'])], p2: [setOf('Snorlax', ['splash'])] });
    const hits = (count: number): ForcedDie => ({ name: { slot: 'p1a', moveId: 'furyattack', kind: 'hit-count' }, result: { hits: count } });
    const total = (count: number) => preview(battle, { p1: [move('furyattack', 'Fury Attack', { dice: [hits(count)] })], p2: [] }).damage.p1.default[0][0].rolls!;
    expect(total(2).hits).toBe(2);
    expect(total(5).hits).toBe(5);
    expect(total(5).damage[15]).toBeGreaterThan(total(2).damage[15]);
  });
});

describe('the damage preview with forced dice in doubles', () => {
  const battle = () => diceBattle({
    format: 'gen9doublescustomgame',
    p1: [setOf('Garchomp', ['rockslide', 'splash']), setOf('Blissey', ['splash'])],
    p2: [setOf('Snorlax', ['splash']), setOf('Snorlax', ['splash'])],
  });

  test('a forced crit on one target of a spread move prices that target as a crit and the other as a hit', () => {
    const picks: Picks = { p1: [move('rockslide', 'Rock Slide', { dice: [crit('p1a', 'rockslide', 'p2b')] })], p2: [] };
    const { state, damage } = preview(battle(), picks);
    const spread = damage.p1.spread[0][state.p1MovesBySlot![0][0].slot];
    const [first, second] = spread;
    expect(first.label).toBe('P2A');
    expect(second.result.rolls!.damage[15]).toBeGreaterThan(first.result.rolls!.damage[15]);
  });
});

describe('the rolls of a die name', () => {
  test('singles read the move default, doubles read the target or the spread entry', () => {
    const picks: Picks = { p1: [move('airslash', 'Air Slash')], p2: [] };
    const { state, damage } = preview(singles(), picks);
    const slot = damage.p1;
    const lookup = (name: string, target: string) => rollsFor({ slot: 'p1a', moveId: name, targetSlot: target, kind: 'damage-roll' }, {
      moves: state.p1MovesBySlot![0], dmgResults: slot.default[0], spreadDamageResults: slot.spread[0], targetDamageResults: slot.targets[0],
    });
    expect(lookup('airslash', 'p2a')).toEqual(slot.default[0][0].rolls);
    expect(lookup('tackle', 'p2a')).toBeUndefined();
    expect(lookup('splash', 'p2a')).toBeUndefined();
  });
});
