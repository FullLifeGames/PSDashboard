import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DiceReport } from '../src/dice/types';
import {
  accuracy, branchOf, clickWith, mon, runTurn, seedOfBranch, turnLines, type Commands, type SlotChoices,
} from './branch-dice-support';

/**
 * Round 82 (forced dice), step A6: `executeBranchChoices` takes the forced dice of both sides from the slot choices and plays
 * the turn through the dice module. A turn without a forced die plays the code of today; a turn that pauses for a switch
 * (U-turn and its kin) keeps its dice for the rest of the turn.
 */
await loadSimMods('gen9championsou');

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24', '25,26,27,28', '29,30,31,32'];
const missed = (lines: string[], slot: string) => lines.some(line => line.startsWith(`|-miss|${slot}`));
const damaged = (lines: string[], slot: string) => lines.some(line => line.startsWith(`|-damage|${slot}`));

interface Board { format: string; p1: ReturnType<typeof mon>[]; p2: ReturnType<typeof mon>[]; commands: Commands; slots: SlotChoices; die: { slot: string; target: string } }

/** Singles: Snorlax's Mega Kick (75 percent) at Pikachu; Pikachu is faster and uses Tackle (100 percent). */
const SINGLES: Board = {
  format: 'gen9customgame',
  p1: [mon('Pikachu', ['tackle'])], p2: [mon('Snorlax', ['megakick'])],
  commands: [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }],
  slots: { p1: [clickWith('tackle')], p2: [clickWith('megakick')] },
  die: { slot: 'p2a', target: 'p1a' },
};

/** Doubles: the same, with a partner on each side who splashes; Snorlax aims at Pikachu's partner. */
const DOUBLES: Board = {
  format: 'gen9doublescustomgame',
  p1: [mon('Pikachu', ['tackle']), mon('Eevee', ['splash'])], p2: [mon('Snorlax', ['megakick']), mon('Chansey', ['splash'])],
  commands: [{ side: 'p1', command: 'move 1 1, move 1' }, { side: 'p2', command: 'move 1 2, move 1' }],
  slots: { p1: [clickWith('tackle'), clickWith('splash')], p2: [clickWith('megakick'), clickWith('splash')] },
  die: { slot: 'p2a', target: 'p1b' },
};

const withDie = (board: Board, happens: boolean): SlotChoices => {
  const dice = [accuracy(board.die.slot, 'megakick', board.die.target, happens)];
  return { p1: board.slots.p1, p2: [clickWith('megakick', dice), ...board.slots.p2.slice(1)] };
};

async function play(board: Board, seed: string, choices: SlotChoices | null) {
  const runtime = await branchOf(board.format, board.p1, board.p2, seed);
  const start = runtime.battleStream.battle!.log.length;
  const result = await runTurn(runtime, board.commands, choices);
  return { runtime, result, lines: turnLines(runtime, start), seed: seedOfBranch(runtime) };
}

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('a forced die through executeBranchChoices, %s', (_, board) => {
  test('forced yes and forced no decide the hit on every seed, and the report says applied', { timeout: 120000 }, async () => {
    let naturalMisses = 0;
    let naturalHits = 0;
    for (const seed of SEEDS) {
      const natural = await play(board, seed, null);
      if (missed(natural.lines, board.die.slot)) naturalMisses += 1; else naturalHits += 1;
      for (const happens of [true, false]) {
        const forced = await play(board, seed, withDie(board, happens));
        expect(forced.result.ok, seed).toBe(true);
        expect(missed(forced.lines, board.die.slot), `${seed} ${happens}`).toBe(!happens);
        expect(damaged(forced.lines, board.die.target), `${seed} ${happens}`).toBe(happens);
        const report = (forced.result as { dice?: DiceReport }).dice;
        expect(report?.forced.map(entry => entry.took), `${seed} ${happens}`).toEqual(['applied']);
        // the stream stands where the turn without the forced die left it (decision D8)
        expect(forced.seed, `${seed} ${happens}`).toBe(natural.seed);
      }
    }
    // the check bites only when the natural turn goes both ways
    expect(naturalMisses).toBeGreaterThan(0);
    expect(naturalHits).toBeGreaterThan(0);
  });

  test('a turn whose choices carry no die plays byte for byte as without the dice argument', { timeout: 120000 }, async () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const plain = await play(board, seed, null);
      const asked = await play(board, seed, board.slots);
      expect(asked.lines, seed).toEqual(plain.lines);
      expect(asked.seed, seed).toBe(plain.seed);
      expect((asked.result as { dice?: DiceReport }).dice, seed).toBeUndefined();
    }
  });

  test('a choice the natural copy refuses ends in an error and leaves the battle where it was', async () => {
    const runtime = await branchOf(board.format, board.p1, board.p2, SEEDS[0]);
    const battle = runtime.battleStream.battle!;
    const length = battle.log.length;
    const result = await runTurn(runtime, [{ side: 'p1', command: 'move 9' }, ...board.commands.slice(1)], withDie(board, false));
    expect(result.ok).toBe(false);
    expect(battle.turn).toBe(1);
    expect(battle.log.length).toBe(length);
  });
});

describe('the module stays out of a turn without a forced die', () => {
  const source = readFileSync(new URL('../src/branch/execute.ts', import.meta.url), 'utf-8');

  test('execute.ts imports the simulator and the dice module as types or with a dynamic import only', () => {
    const imports = source.split(/\r?\n/).filter(line => /^import\b/.test(line));
    for (const line of imports) {
      if (/from '@pkmn\//.test(line) || /from '\.\.\/dice\//.test(line)) expect(line).toMatch(/^import type\b/);
    }
    expect(source).toMatch(/import\('\.\.\/dice\/turn\.ts'\)/);
  });
});
