import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { makeNode } from '../src/search/mcts-node';
import { searchOptions } from '../src/search/options';
import { createMatchupCache } from '../src/eval-function';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { findConsistentOptions, findPlayedOption, matchPlayedSide } from '../src/turn-analysis/played-match';
import type { StaticRuleset } from '../src/eval-function';
import type { PlayedAction } from '../src/played';
import type { EvalSettings } from '../src/types';

/**
 * Round 67 (T113, stage 1): a doubles move aimed at the own partner (Pollen
 * Puff that heals it, a U-turn into it) is a legal choice, but the option
 * lists name only foe slots for single-target moves, so the played turn had
 * no option and no verdict. At the root, where the played slots are known,
 * the slot also lists the played partner target when the simulator accepts
 * it for that move (battle.validTargetLoc on the request's target type).
 */

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

/** The analysis' own rule: the exact combo, or with a hidden slot any consistent one. */
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
