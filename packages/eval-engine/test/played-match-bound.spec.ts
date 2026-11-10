import { describe, expect, test } from 'vitest';
import { logRules } from '@fulllifegames/replay-core';
import { matchPlayedSide, matchPlayedSlots, phantomStayIn } from '../src/turn-analysis/played-match';
import type { PlayedAction, PlayedTurn, SlotBound } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 89 (#108): the matchers take the order bound of a body that fell before it acted. The bound is optional: absent, both matchers
 * pick as before. Present, they drop the options it rules out before the pick: a move id of `moves`, and a switch when `switchOut` is set.
 * A bound that rules out every option is no proof (the log and the queue disagree), and the pick is the one without it.
 */
const option = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const move = (name: string, targetLoc: number | null = null): PlayedAction => ({ kind: 'move', name, tera: false, targetLoc });

describe('doubles: the slot that fell before it acted (replay 2710981835 turn 7)', () => {
  // Dragonite (slot a) fell to Floette's Dazzling Gleam; Empoleon's Flash Cannon is the logged click of slot b.
  const options = [
    option('move extremespeed 1, move flashcannon 1', 'Extreme Speed→Floette + Flash Cannon→Floette', 0.9),
    option('move protect, move flashcannon 1', 'Protect + Flash Cannon→Floette', 0.8),
    option('switch 3, move flashcannon 1', '→ Sylveon + Flash Cannon→Floette', 0.95),
    option('move dragonpulse 1, move flashcannon 1', 'Dragon Pulse→Floette + Flash Cannon→Floette', 0.5),
    option('move thunderbolt 1, move flashcannon 1', 'Thunderbolt→Floette + Flash Cannon→Floette', 0.4),
  ];
  const slots = [null, move('Flash Cannon', 1)];
  const bound: SlotBound = { moves: ['extremespeed', 'protect'], switchOut: true };

  test('without a bound the charitable pick is the best consistent option, as before', () => {
    expect(matchPlayedSlots(options, slots)).toMatchObject({ played: { choice: 'switch 3, move flashcannon 1' }, partial: true });
    expect(matchPlayedSlots(options, slots, undefined)).toEqual(matchPlayedSlots(options, slots));
  });

  test('with the bound Extreme Speed, Protect and the switch drop out: Dragon Pulse is the best that is left', () => {
    expect(matchPlayedSlots(options, slots, [bound, null])).toMatchObject({ played: { choice: 'move dragonpulse 1, move flashcannon 1' }, partial: true });
  });

  test('a bound on a slot that was seen is not read, and a null bound leaves the slot alone', () => {
    expect(matchPlayedSlots(options, slots, [null, bound]).played?.choice).toBe('switch 3, move flashcannon 1');
    expect(matchPlayedSlots(options, [move('Extreme Speed', 1), move('Flash Cannon', 1)], [bound, null]))
      .toMatchObject({ played: { choice: 'move extremespeed 1, move flashcannon 1' }, partial: false });
  });

  test('a bound that rules out every consistent option is no proof', () => {
    const all: SlotBound = { moves: ['extremespeed', 'protect', 'dragonpulse', 'thunderbolt'], switchOut: true };
    expect(matchPlayedSlots(options, slots, [all, null]).played?.choice).toBe('switch 3, move flashcannon 1');
  });

  test('a tera or mega marker does not hide the move id', () => {
    const marked = [option('move extremespeed 1 mega, move flashcannon 1', 'Mega + Extreme Speed→Floette + Flash Cannon→Floette', 0.99), ...options.slice(3)];
    expect(matchPlayedSlots(marked, slots, [bound, null]).played?.choice).toBe('move dragonpulse 1, move flashcannon 1');
  });

  test('the side dispatcher passes the bound of its side', () => {
    const result: EvalResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: options, p2: [] } };
    const played: PlayedTurn = { p1: null, p2: null, p1Slots: slots, p2Slots: undefined };
    expect(matchPlayedSide(result, 'p1', played)?.choice).toBe('switch 3, move flashcannon 1');
    expect(matchPlayedSide(result, 'p1', played, { p1: [bound, null] })?.choice).toBe('move dragonpulse 1, move flashcannon 1');
  });
});

describe('singles: the stay-in phantom of a side that fell before it acted', () => {
  const rules = logRules('');
  const result = (...p2: RankedChoice[]): EvalResult => ({ score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2 } });
  const played: PlayedTurn = { p1: move('Psyshock'), p2: null, prevented: { p2: 'faint' } };
  // Grafaiai (Prankster) fell to Psyshock before it acted: Parting Shot ran at +1 and is out.
  const grafaiai = result(
    option('switch 2', '→ Gholdengo', 0.9),
    option('move partingshot', 'Parting Shot', 0.6),
    option('move lowkick', 'Low Kick', 0.3),
    option('move gunkshot', 'Gunk Shot', 0.2),
  );

  test('without a bound the Dex priority picks, as before', () => {
    expect(phantomStayIn(grafaiai, 'p2', played, rules)?.choice).toBe('move partingshot');
  });

  test('with the bound the Prankster move is out and the best move that is left stays in', () => {
    const phantom = phantomStayIn(grafaiai, 'p2', played, rules, { moves: ['partingshot'], switchOut: true });
    expect(phantom?.choice).toBe('move lowkick');
    expect(phantom?.label).toContain('stayed in');
  });

  test('with a bound the Dex priority is not read: a priority move the queue does not rule out stands in', () => {
    const withPriority = result(option('move suckerpunch', 'Sucker Punch', 0.7), option('move lowkick', 'Low Kick', 0.3));
    expect(phantomStayIn(withPriority, 'p2', played, rules)?.choice).toBe('move lowkick');
    expect(phantomStayIn(withPriority, 'p2', played, rules, { moves: [], switchOut: true })?.choice).toBe('move suckerpunch');
  });

  test('a bound that rules out every move falls back to the Dex pick', () => {
    expect(phantomStayIn(grafaiai, 'p2', played, rules, { moves: ['partingshot', 'lowkick', 'gunkshot'], switchOut: true })?.choice).toBe('move partingshot');
  });

  test('the marker still decides: no faint prevention, no phantom, bound or not', () => {
    const bound: SlotBound = { moves: ['partingshot'], switchOut: true };
    expect(phantomStayIn(grafaiai, 'p2', { ...played, prevented: { p2: 'slp' } }, rules, bound)).toBeNull();
    expect(phantomStayIn(grafaiai, 'p2', { ...played, prevented: {} }, rules, bound)).toBeNull();
  });

  test('a doubles-shaped parse gets no phantom, bound or not', () => {
    expect(phantomStayIn(grafaiai, 'p2', { ...played, p2Slots: [null, null] }, rules, { moves: [], switchOut: true })).toBeNull();
  });
});
