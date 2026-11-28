import { describe, expect, test } from 'vitest';
import { logRules, rulesDex } from '@fulllifegames/replay-core';
import {
  matchPlayedSide,
  matchPlayedSlots,
  noChoiceSlots,
  phantomStayIn,
  standsIn,
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
import { analyzeTurn, playedSetupMove, type SideAnalysis } from '../src/analysis';

const option = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const move = (name: string, targetLoc: number | null = null): PlayedAction => ({ kind: 'move', name, tera: false, targetLoc });

describe('doubles: the slot that fell before it acted (replay 2710981835 turn 7)', () => {
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

describe('doubles: the slots that show no choice in the log', () => {
  const mark = { before: [], speedMoved: false, activations: [] };
  const turn = (slots: (PlayedAction | null)[], extra: Partial<PlayedTurn> = {}): PlayedTurn => ({ p1: null, p2: null, p1Slots: slots, ...extra });

  test('a body that fell before it acted: its slot is named with the reason, the slot that moved is not', () => {
    expect(noChoiceSlots(turn([null, move('Protect')], { fell: { p1: [mark, null] } }), 'p1', 2)).toEqual([{ slot: 0, reason: 'fell' }]);
    expect(noChoiceSlots(turn([move('Protect'), null], { fell: { p1: [null, mark] } }), 'p1', 2)).toEqual([{ slot: 1, reason: 'fell' }]);
  });

  test('a body the game ended before it moved is named too, and a fall beside it keeps its own reason', () => {
    expect(noChoiceSlots(turn([null, move('Aqua Jet')], { ended: { p1: [true, false] } }), 'p1', 2)).toEqual([{ slot: 0, reason: 'ended' }]);
    expect(noChoiceSlots(turn([null, null], { fell: { p1: [mark, null] }, ended: { p1: [false, true] } }), 'p1', 2))
      .toEqual([{ slot: 0, reason: 'fell' }, { slot: 1, reason: 'ended' }]);
  });

  test('an empty slot is no body: a side of one body names the fallen slot alone, and an ambiguous one names none', () => {
    expect(noChoiceSlots(turn([null, null], { fell: { p1: [null, mark] }, ended: { p1: [true, false] } }), 'p1', 1)).toEqual([{ slot: 1, reason: 'fell' }]);
    expect(noChoiceSlots(turn([null, move('Protect')], { ended: { p1: [true, false] } }), 'p1', 1)).toEqual([]);
    expect(noChoiceSlots(turn([null, null], { ended: { p1: [true, true] } }), 'p1', 1)).toEqual([]);
  });

  test('a slot with a cant, a hidden action or no mark is not named, and a side without slots has none', () => {
    expect(noChoiceSlots(turn([null, move('Protect')]), 'p1', 2)).toEqual([]);
    expect(noChoiceSlots(turn([move('Protect'), move('Surf')], { fell: { p1: [null, null] } }), 'p1', 2)).toEqual([]);
    expect(noChoiceSlots({ p1: move('Surf'), p2: null }, 'p1', 1)).toEqual([]);
    expect(noChoiceSlots(null, 'p1', 2)).toEqual([]);
  });

  test('a side stands in when its played line rests on a stand-in: the singles stand-in or a slot with no choice', () => {
    expect(standsIn({ neverActed: true })).toBe(true);
    expect(standsIn({ noChoiceSlots: [{ slot: 0, reason: 'ended' }] })).toBe(true);
    expect(standsIn({ noChoiceSlots: [] })).toBe(false);
    expect(standsIn({})).toBe(false);
  });
});

describe('doubles: the grade of a side with a slot that showed no choice', () => {
  const mark = { before: [{ slot: 'p2a', move: 'Flare Blitz' }], speedMoved: false, activations: [] };
  const rows = (punisher: string): EvalResult => ({
    score: 0, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [option('move surf 1, move earthpower 1', 'Surf→Foe + Earth Power→Foe', 0.5), { ...option('move irondefense, move protect', 'Iron Defense + Protect', -0.2), punishedBy: punisher }],
      p2: [option('move flareblitz 1, move stealthrock', 'Flare Blitz→Foe + Stealth Rock', 0.2), option('move icebeam 1, move stealthrock', 'Ice Beam→Foe + Stealth Rock', 0.1)],
    },
  });
  const turnOf = (played: PlayedTurn) => analyzeTurn({
    turn: 7, result: rows('Flare Blitz→Foe + Stealth Rock'), played, playedOutcome: null, scoreBefore: 0, scoreAfter: 0, playedTracking: true,
  });
  const foe = [move('Ice Beam', 1), move('Stealth Rock')];
  const log = (extra: Partial<PlayedTurn>): PlayedTurn => ({ p1: null, p2: null, p1Slots: [null, move('Protect')], p2Slots: foe, ...extra });

  test('the fallen slot is named, the moved slot is matched, and the grade stays the stay-in against the best', () => {
    const plain = turnOf(log({}));
    const fell = turnOf(log({ fell: { p1: [mark, null] } }));
    expect(fell.p1.noChoiceSlots).toEqual([{ slot: 0, reason: 'fell' }]);
    expect(plain.p1.noChoiceSlots).toBeUndefined();
    expect(fell.p1.played?.choice).toBe('move irondefense, move protect');
    expect(fell.p1.playedPartial).toBe(true);
    expect([fell.p1.tier, fell.p1.regret, fell.p1.best?.choice]).toEqual([plain.p1.tier, plain.p1.regret, plain.p1.best?.choice]);
    expect(fell.p1.tier).toBe('blunder');
  });

  test('a stand-in earns no risk framing: the unpunished risk of the plain turn is gone', () => {
    expect(turnOf(log({})).p1.riskUnpunished).toBe(true);
    expect(turnOf(log({ fell: { p1: [mark, null] } })).p1.riskUnpunished).toBeUndefined();
    expect(turnOf(log({ ended: { p1: [true, false] } })).p1.riskUnpunished).toBeUndefined();
  });

  test('both bodies without an action: no played line, both slots named', () => {
    const none = turnOf({ p1: null, p2: null, p1Slots: [null, null], p2Slots: foe, fell: { p1: [mark, null] }, ended: { p1: [false, true] } });
    expect(none.p1.noChoiceSlots).toEqual([{ slot: 0, reason: 'fell' }, { slot: 1, reason: 'ended' }]);
    expect(none.p1.played).toBeNull();
    expect(none.p1.regret).toBeNull();
  });

  test('the foe side, whose two slots both moved, carries no mark', () => {
    expect(turnOf(log({ fell: { p1: [mark, null] } })).p2.noChoiceSlots).toBeUndefined();
  });
});

describe('singles: the stay-in phantom of a side that fell before it acted', () => {
  const rules = logRules('');
  const result = (...p2: RankedChoice[]): EvalResult => ({ score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2 } });
  const played: PlayedTurn = { p1: move('Psyshock'), p2: null, prevented: { p2: 'faint' } };
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

describe('moves onto the partner at the root', () => {
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
