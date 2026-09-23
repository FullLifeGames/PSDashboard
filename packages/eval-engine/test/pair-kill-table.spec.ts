import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { legalChoices } from '../src/forward-model';
import { drawPair, type PairDraw } from '../src/pair/draw';
import { killTable, rollValue } from '../src/pair/kill-table';
import { hpAfterHit, movesLater, randomDeviation } from '../src/pair/log';
import type { RollRecord } from '../src/pair/prng';
import type { HitSnapshot } from '../src/pair/snapshot';
import { anchorRoot, doublesRoot, pairSet, PLAYED } from './pair-battles';

const targetOf = (key: string) => key.slice(key.indexOf('>') + 1);

/** Every roll of a draw against the table: the value for the drawn roll is the damage the log shows (at least the HP on a kill). */
function check(drawn: PairDraw, alter: (snap: HitSnapshot) => HitSnapshot = snap => snap) {
  let checked = 0;
  let mismatched = 0;
  for (const record of drawn.records) {
    if (record.kind !== 'roll') continue;
    const roll = record as RollRecord;
    const after = hpAfterHit(drawn.log, roll.logIndex, targetOf(roll.key), roll.snapshot.defender.maxhp);
    if (after === null) continue;
    const table = killTable(alter(roll.snapshot));
    expect(table).not.toBeNull();
    const value = rollValue(table!, roll.roll, roll.crit);
    const before = roll.snapshot.defender.hp;
    const ok = after === 0 ? value >= before : value === before - after;
    checked += 1;
    if (!ok) mismatched += 1;
  }
  return { checked, mismatched };
}

const draw = (root: ReturnType<typeof anchorRoot>, p1: string, p2: string, seed = '1,2,3,4') =>
  drawPair(root, p1, p2, seed as never, new Map(), createMatchupCache());

describe('kill tables from the calc, checked at the drawn roll (round 56)', () => {
  test('every roll of the anchor cells lands on the table to the HP', () => {
    const root = anchorRoot();
    const p1Options = legalChoices(root, 'p1', { tera: false }).map(option => option.choice);
    const p2Options = legalChoices(root, 'p2', { tera: false }).map(option => option.choice);
    let checked = 0;
    let mismatched = 0;
    for (const p1 of p1Options) {
      const result = check(draw(root, p1, PLAYED[1]));
      checked += result.checked;
      mismatched += result.mismatched;
    }
    for (const p2 of p2Options) {
      const result = check(draw(root, PLAYED[0], p2));
      checked += result.checked;
      mismatched += result.mismatched;
    }
    expect(checked).toBeGreaterThan(100);
    expect(mismatched).toBe(0);
  });

  test('a spread move against one living target takes no spread modifier', () => {
    // Dazzling Gleam never misses, so the draw always rolls damage on the one target left.
    const gleam = pairSet('Gleam', 'Gardevoir', ['Dazzling Gleam', 'Protect']);
    const wall = pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect']);
    const root = doublesRoot([gleam, wall], [pairSet('Target', 'Snorlax', ['Protect', 'Rest']), pairSet('Gone', 'Pikachu', ['Protect'])], battle => {
      battle.sides[1].active[1]!.faint();
      battle.faintMessages();
    });
    const p2 = legalChoices(root, 'p2', { tera: false }).find(option => option.choice.startsWith('move rest'))!.choice;
    const drawn = draw(root, 'move dazzlinggleam, move softboiled', p2);
    const roll = drawn.records.find((record): record is RollRecord => record.kind === 'roll')!;
    expect(roll.snapshot.spreadHit).toBe(false);
    expect(check(drawn)).toEqual({ checked: 1, mismatched: 0 });
  });

  test('a spread move against a protected partner keeps the spread modifier', () => {
    const root = anchorRoot();
    // Mawile (p1b) protects: p2a's Matcha Gotcha still started against two targets, so p1a takes the spread modifier.
    const drawn = draw(root, 'move lifedew, move protect', 'move matchagotcha, switch 3');
    const intoSinistcha = drawn.records.find((record): record is RollRecord => record.kind === 'roll' && record.key === 'p2a:matchagotcha>p1a')!;
    expect(intoSinistcha.snapshot.spreadHit).toBe(true);
    expect(drawn.log.some(line => line.startsWith('|-activate|p1b: Mawile|move: Protect'))).toBe(true);
    expect(check(drawn).mismatched).toBe(0);
  });

  test('a partner\'s Sword of Ruin reaches the calc, and a snapshot without it misses the damage', () => {
    const root = doublesRoot(
      [pairSet('Pao', 'Chien-Pao', ['Protect', 'Ice Spinner'], { ability: 'Sword of Ruin' }), pairSet('Chomp', 'Garchomp', ['Dragon Claw', 'Protect'])],
      [pairSet('Tank', 'Snorlax', ['Protect', 'Rest']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
    );
    const drawn = draw(root, 'move protect, move dragonclaw 1', 'move rest, move softboiled');
    const result = check(drawn);
    expect(result).toEqual({ checked: 1, mismatched: 0 });
    const blind = check(drawn, snap => ({ ...snap, fieldAbilities: snap.fieldAbilities.filter(id => id !== 'swordofruin') }));
    expect(blind.mismatched).toBe(1);
  });

  test('Helping Hand, Friend Guard and a doubles Reflect reach the calc', () => {
    const root = doublesRoot(
      [pairSet('Hand', 'Clefable', ['Helping Hand', 'Protect']), pairSet('Chomp', 'Garchomp', ['Dragon Claw', 'Protect'])],
      [pairSet('Tank', 'Snorlax', ['Protect', 'Rest']), pairSet('Guard', 'Clefairy', ['Protect', 'Moonblast'], { ability: 'Friend Guard' })],
      // Outside an event the sim wants a source for a side condition: 'debug' stands for the side's first active.
      (battle: Battle) => { battle.sides[1].addSideCondition('reflect', 'debug'); },
    );
    const drawn = draw(root, 'move helpinghand -2, move dragonclaw 1', 'move rest, move moonblast 2');
    const hand = drawn.records.find((record): record is RollRecord => record.kind === 'roll' && record.key === 'p1b:dragonclaw>p2a')!;
    expect(hand.snapshot.helpingHand).toBe(true);
    expect(hand.snapshot.defenderPartner).toBe('friendguard');
    expect(hand.snapshot.screens).toContain('reflect');
    // Dragon Claw into Snorlax and Moonblast into Garchomp: both rolls land on their tables.
    expect(check(drawn)).toEqual({ checked: 2, mismatched: 0 });
  });

  test('the log readers: HP after a hit, random deviations, who moves later', () => {
    const drawn = draw(anchorRoot(), ...PLAYED);
    const mg = drawn.records.find((record): record is RollRecord => record.kind === 'roll' && record.key === 'p2a:matchagotcha>p1b')!;
    expect(hpAfterHit(drawn.log, mg.logIndex, 'p1b', 125)).toBe(51);
    expect(randomDeviation(drawn.log)).toBeNull();
    expect(randomDeviation(['|cant|p2a: Snorlax|flinch'])).toBe('cant:flinch');
    expect(randomDeviation(['|cant|p2a: Snorlax|recharge'])).toBeNull();
    expect(randomDeviation(['|-activate|p1a: Pikachu|confusion'])).toBe('confusion');
    expect(randomDeviation(['|drag|p2a: Blissey|Blissey, L50|100/100'])).toBe('drag');
    expect(movesLater(drawn.log, 0, 'p2a')).toBe(true);
    expect(movesLater(drawn.log, drawn.log.length, 'p2a')).toBe(false);
  });
});
