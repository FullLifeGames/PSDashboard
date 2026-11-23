import { describe, expect, test } from 'vitest';
import { logRules, rulesDex } from '@fulllifegames/replay-core';
import {
  matchPlayedSide,
  matchPlayedSlots,
  phantomStayIn,
  findConsistentOptions,
  findPlayedOption,
  setupMoveClicked,
} from '../src/turn-analysis/played-match';
import type { PlayedAction, PlayedTurn, SlotBound } from '../src/played';
import type { EvalResult, RankedChoice, EvalSettings } from '../src/types';
import { readFileSync } from 'node:fs';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { makeNode } from '../src/search/mcts-node';
import { searchOptions } from '../src/search/options';
import { createMatchupCache } from '../src/eval-function';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import type { StaticRuleset } from '../src/eval-function';
import { playedSetupMove, type SideAnalysis } from '../src/analysis';

/**
 * The matchers take the order bound of a body that fell before it acted (optional; absent, both pick as before). Present, they drop the options
 * it rules out before the pick: a move id of `moves`, and a switch when `switchOut` is set. A bound that rules out every option is no proof
 * (the log and the queue disagree), and the pick is the one without it.
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

interface Position {
  serialized: string;
  tera: EvalSettings['tera'];
  sleepClause: boolean;
  ruleset: StaticRuleset;
  keepPlayed: NonNullable<EvalSettings['keepPlayed']>;
}

const fixture = (name: string): Position =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Position;

const slotsOf = (position: Position, side: 'p1' | 'p2'): (PlayedAction | null)[] => position.keepPlayed[`${side}Slots`] ?? [];

const matched = (options: { choice: string; label: string }[], slots: (PlayedAction | null)[]) =>
  findPlayedOption(options, slots) ?? (slots.some(action => action === null) ? findConsistentOptions(options, slots)[0] ?? null : null);

const CASES: [string, 'p1' | 'p2', string][] = [
  ['gen9vgc2026regi-2630685175-t7-played', 'p2', 'Pollen Puff heals Rillaboom'],
  ['smogtours-gen9doublesou-938276-t10-played', 'p1', 'Pollen Puff on the partner beside Flare Blitz'],
  ['smogtours-gen9doublesou-938281-t8-played', 'p2', 'U-turn into the partner, the other slot hidden'],
];

describe('moves onto the partner at the root (round 67, T113)', () => {
  test.each(CASES)('%s %s: the played partner move is a root option (%s)', (name, side) => {
    const position = fixture(name);
    const root = createRootPosition(position.serialized, position.ruleset);
    const slots = slotsOf(position, side);
    const options = searchOptions(root, side, { tera: position.tera, keep: slots, sleepClause: position.sleepClause });
    expect(matched(options, slots)?.choice).toMatch(/ -[12]\b/);
  });

  test('2630685175 t7: the orchestrated search ranks and grades p2\'s played Pollen Puff', { timeout: 120_000 }, async () => {
    const position = fixture('gen9vgc2026regi-2630685175-t7-played');
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, position.ruleset), {
      depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, keepPlayed: position.keepPlayed,
    });
    const played = { p1: null, p2: null, p1Slots: position.keepPlayed.p1Slots, p2Slots: position.keepPlayed.p2Slots };
    expect(matchPlayedSide(result, 'p2', played)?.choice).toMatch(/^move pollenpuff -2/);
  });

  test('a played own-side target the simulator rejects adds no option', () => {
    const position = fixture('gen9vgc2026regi-2630685175-t7-played');
    const root = createRootPosition(position.serialized, position.ruleset);
    // Wide Guard covers the own side without a target: the simulator rejects a slot for it.
    const slots: (PlayedAction | null)[] = [null, { kind: 'move', name: 'Wide Guard', tera: false, targetLoc: -1 }];
    expect(legalChoices(root, 'p2', { tera: position.tera, partner: slots }).map(option => option.choice))
      .toEqual(legalChoices(root, 'p2', { tera: position.tera }).map(option => option.choice));
  });

  test('singles lists and the nodes below the root stay as they are', () => {
    const singles = JSON.parse(readFileSync(new URL('./fixtures/positions/smogtours-gen6ou-649664-t14-g1.json', import.meta.url), 'utf-8')) as Position;
    const singlesRoot = createRootPosition(singles.serialized, singles.ruleset);
    const keep = [{ kind: 'move', name: 'Scald', tera: false, targetLoc: -1 }] as PlayedAction[];
    expect(searchOptions(singlesRoot, 'p1', { tera: false, keep }).map(option => option.choice))
      .toEqual(searchOptions(singlesRoot, 'p1', { tera: false }).map(option => option.choice));
    const position = fixture('gen9vgc2026regi-2630685175-t7-played');
    const child = makeNode(createRootPosition(position.serialized, position.ruleset), position.tera ?? true, createMatchupCache(position.ruleset), undefined, position.sleepClause);
    expect(child.p2Options.some(option => / -[12]\b/.test(option.choice) && /pollenpuff|uturn/.test(option.choice))).toBe(false);
    expect(positionBattle(child.position).gameType).toBe('doubles');
  });
});

const side = (over: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, regret: null, ...over });
const dex = rulesDex(9);

describe('setup-move detection', () => {
  test('singles: the played move is recognized by name', () => {
    expect(setupMoveClicked(side({ playedRaw: { kind: 'move', name: 'Swords Dance' } }), dex)).toBe('Swords Dance');
    expect(setupMoveClicked(side({ playedRaw: { kind: 'move', name: 'Ice Beam' } }), dex)).toBeNull();
    expect(setupMoveClicked(side({ playedRaw: { kind: 'switch', name: 'Curse' } }), dex)).toBeNull();
    expect(setupMoveClicked(side({}), dex)).toBeNull();
  });

  test('doubles: any slot clicking a setup move counts', () => {
    expect(setupMoveClicked(side({ playedSlots: [null, { kind: 'move', name: 'Dragon Dance' }] }), dex)).toBe('Dragon Dance');
    expect(setupMoveClicked(side({ playedSlots: [{ kind: 'move', name: 'Protect' }, { kind: 'move', name: 'Fake Out' }] }), dex)).toBeNull();
  });

  test('the record names the clicked setup move, and none without one', () => {
    expect(playedSetupMove(side({ setupMove: 'Swords Dance' }))).toBe('Swords Dance');
    expect(playedSetupMove(side({}))).toBeNull();
  });
});
