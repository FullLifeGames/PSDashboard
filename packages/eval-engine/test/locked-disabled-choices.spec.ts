import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { legalChoices } from '../src/forward/choices';
import { createRootPosition, forkBattle } from '../src/forward/position';
import { applyChoice } from '../src/forward/switches';
import { serializeBattleStable } from '../src/forward/serialize';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

/**
 * Round 72 (T246b): a Pokemon locked into a move (Outrage, a charge, Uproar) whose move Disable has hit. The request lists the
 * locked entry with no `disabled` key, and the simulator plays it (side.js chooseMove returns the locked move before it reads
 * the disabled flag), but the moveSlot carries `disabled: true`. The search's slot choices dropped every entry whose id sat in
 * that live-disabled set, the locked slot offered nothing, and a doubles side was left with the partner's part alone: "move
 * flashcannon 1" went to the Charizard in slot a ("Your Charizard doesn't have a move matching flashcannon", Champions VGC
 * gen9championsvgc2026regmbbo3-2680872224, one of 1,445 positions). Held against the simulator: every locked move of every
 * view (Generations 1 to 9, Champions, both doubles rule sets) is played with its slot flagged disabled, and the choices the
 * search offers must name the locked move and be accepted on a copy of the battle.
 */

const SEED: [number, number, number, number] = [1, 2, 3, 4];

const STAYS = mon('Blissey', ['splash']);
const sturdy = (moves: string[]) => mon('Snorlax', moves);

/** One turn on a board where p1's first body uses `move` against a body that splashes. Null when the move is not playable here. */
function afterFirstTurn(view: SimView, moveName: string): Battle | null {
  const p1 = view.doubles ? [sturdy([moveName, 'splash']), STAYS, STAYS, STAYS] : [sturdy([moveName, 'splash']), STAYS];
  const p2 = view.doubles ? [STAYS, STAYS, STAYS, STAYS] : [STAYS, STAYS];
  const attempts = view.doubles ? ['move 1 1, move 1', 'move 1, move 1', 'move 1 -2, move 1'] : ['move 1'];
  for (const attempt of attempts) {
    const battle = battleIn(view, p1, p2);
    if (!battle.choose('p1', attempt)) continue;
    battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
    if (battle.turn === 2) return battle;
  }
  return null;
}

/** The locked entry of slot a (a request entry with no target key), or null. */
function lockedEntry(battle: Battle): { id: string; move: string } | null {
  const entry = (battle.sides[0].activeRequest as { active?: { moves?: { id?: string; move: string; target?: unknown }[] }[] } | null)?.active?.[0];
  const first = entry?.moves?.[0];
  return entry?.moves?.length === 1 && first && !('target' in first) && first.id ? { id: first.id, move: first.move } : null;
}

function rejectedBySimulator(battle: Battle, offered: string[]): string[] {
  const position = createRootPosition(serializeBattleStable(battle));
  const rejected: string[] = [];
  for (const choice of offered) {
    try {
      applyChoice(forkBattle(position, SEED), 'p1', choice);
    } catch (error) {
      rejected.push(`${choice}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return rejected;
}

describe.each(ALL_VIEWS)('$name: a locked move whose slot Disable flagged stays a choice (round 72, T246b)', view => {
  const locked: { move: string; id: string; battle: Battle }[] = [];
  for (const move of view.dex.moves.all()) {
    if (move.isNonstandard === 'Future' || move.isNonstandard === 'CAP' || move.isZ || move.isMax || move.id === 'struggle') continue;
    if (move.id.startsWith('hiddenpower') && move.id !== 'hiddenpower') continue;
    const battle = afterFirstTurn(view, move.name);
    const entry = battle && lockedEntry(battle);
    // A locked entry whose id has no moveSlot (the recharge turn) cannot be flagged disabled.
    if (battle && entry && battle.sides[0].active[0]!.moveSlots.some(slot => slot.id === entry.id)) locked.push({ move: move.name, id: entry.id, battle });
  }

  test('the view has locked moves to play', () => {
    expect(locked.length).toBeGreaterThan(3);
  });

  test('with the moveSlot flagged disabled the search offers the locked move and the simulator accepts every choice', () => {
    const missing: string[] = [];
    const rejected: string[] = [];
    for (const { move, id, battle } of locked) {
      battle.sides[0].active[0]!.moveSlots.find(slot => slot.id === id)!.disabled = true;
      const offered = legalChoices(createRootPosition(serializeBattleStable(battle)), 'p1').map(option => option.choice);
      if (!offered.some(choice => choice.split(',')[0].trim().split(' ')[1] === id)) missing.push(`${move}: offered ${JSON.stringify(offered)}`);
      rejected.push(...rejectedBySimulator(battle, offered).map(line => `${move}: ${line}`));
    }
    expect(missing).toEqual([]);
    expect(rejected).toEqual([]);
  });

  test('the simulator itself plays the locked move with the slot flagged (the offered choice is not a guess)', () => {
    const refused: string[] = [];
    for (const { move, id, battle } of locked) {
      battle.sides[0].active[0]!.moveSlots.find(slot => slot.id === id)!.disabled = true;
      const copy = forkBattle(createRootPosition(serializeBattleStable(battle)), SEED);
      // A locked entry goes by its index: by name the simulator assumes a target type and asks for a target (submittableChoice).
      const choice = view.doubles ? 'move 1, move splash' : 'move 1';
      if (!copy.choose('p1', choice)) refused.push(`${move}: ${copy.sides[0].choice.error}`);
    }
    expect(refused).toEqual([]);
  });
});

describe.each(ALL_VIEWS.filter(view => ['Gen 9', 'Champions', 'Scarlet/Violet doubles', 'Champions doubles'].includes(view.name)))(
  '$name: Disable hits a Charizard locked into Outrage (the reported scene)',
  view => {
    const charizard = mon('Charizard', ['outrage', 'earthquake', 'protect', 'splash'], { evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } });
    // A Normal-type disabler: Outrage hits it (a Fairy takes no hit, so no lock starts), and its Speed stays below the Charizard's.
    const slow = (moves: string[]) => mon('Snorlax', moves, { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 } });
    const board = () => {
      const p1 = view.doubles ? [charizard, mon('Empoleon', ['flashcannon', 'icebeam', 'hydropump', 'protect']), STAYS, STAYS] : [charizard, STAYS];
      // Outrage picks its target at random: the partner must survive the hit, or the turn ends on a forced switch.
      const p2 = view.doubles ? [slow(['disable', 'splash']), slow(['splash']), STAYS, STAYS] : [slow(['disable', 'splash']), STAYS];
      const battle = battleIn(view, p1, p2);
      battle.choose('p1', view.doubles ? 'move outrage, move protect' : 'move outrage');
      battle.choose('p2', view.doubles ? 'move disable 1, move splash' : 'move disable');
      return battle;
    };

    test('the simulator flags the slot and still lists the locked entry', () => {
      const battle = board();
      const charizardNow = battle.sides[0].active[0]!;
      expect(charizardNow.volatiles['lockedmove']).toBeDefined();
      expect(charizardNow.moveSlots.find(slot => slot.id === 'outrage')!.disabled).toBe(true);
      expect(lockedEntry(battle)).toEqual({ id: 'outrage', move: 'Outrage' });
    });

    test('the search offers the locked move, with the partner in doubles, and the simulator accepts every choice', () => {
      const battle = board();
      const offered = legalChoices(createRootPosition(serializeBattleStable(battle)), 'p1').map(option => option.choice);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.every(choice => choice.startsWith('move outrage') || choice.startsWith('switch'))).toBe(true);
      if (view.doubles) expect(offered.every(choice => choice.split(',').length === 2)).toBe(true);
      expect(rejectedBySimulator(battle, offered)).toEqual([]);
    });

    test('a free entry Imprison disables stays barred (the request may hide the flag; the live-disabled set was written for that)', () => {
      const p1 = view.doubles ? [charizard, mon('Empoleon', ['flashcannon', 'protect']), STAYS, STAYS] : [charizard, STAYS];
      const p2 = view.doubles ? [slow(['imprison', 'earthquake']), slow(['splash']), STAYS, STAYS] : [slow(['imprison', 'earthquake']), STAYS];
      const free = battleIn(view, p1, p2);
      free.choose('p1', view.doubles ? 'move protect, move protect' : 'move protect');
      free.choose('p2', view.doubles ? 'move imprison, move splash' : 'move imprison');
      const user = free.sides[0].active[0]!;
      expect(user.moveSlots.find(slot => slot.id === 'earthquake')!.disabled).toBe('hidden');
      const offered = legalChoices(createRootPosition(serializeBattleStable(free)), 'p1').map(option => option.choice);
      expect(offered.some(choice => choice.includes('outrage'))).toBe(true);
      expect(offered.some(choice => choice.includes('earthquake'))).toBe(false);
      expect(rejectedBySimulator(free, offered)).toEqual([]);
    });
  },
);
