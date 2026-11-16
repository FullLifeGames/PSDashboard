import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { chooseOnCopy as branchCopy } from '../src/branch/execute';
import { chooseOnCopy as diceCopy } from '../src/dice/logged-block';
import type { SimBattle } from '../src/branch/types';

/**
 * Round 89 (final gate, D8a): `chooseOnCopy` of branch/execute.ts is a deliberate copy of the one in dice/logged-block.ts (the branch
 * module loads the dice layer lazily and keeps its own). AGENTS.md asks a deliberate copy for a spec that compares the two: both play
 * the same commands on equal copies of a battle, in singles and doubles, and leave the same log, or both throw the same message,
 * for a refusal of either side and for a refusal that carries no text (the fallback sentence).
 */
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', level: 100, gender: '',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function board(doubles: boolean): Battle {
  const mons = (moves: string[]): PokemonSet[] => (doubles ? [set('Snorlax', moves), set('Blissey', ['Soft-Boiled', 'Tackle'])] : [set('Snorlax', moves)]);
  const battle = new Battle({
    formatid: toID(doubles ? 'gen9doublescustomgame' : 'gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(mons(['Body Slam', 'Curse'])) }, p2: { name: 'Beta', team: Teams.pack(mons(['Body Slam', 'Curse'])) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  return battle;
}

type Commands = { side: 'p1' | 'p2'; command: string }[];
type Copy = (battle: SimBattle & Battle, commands: Commands) => void;
const copies: [string, Copy][] = [['branch/execute.ts', branchCopy as Copy], ['dice/logged-block.ts', diceCopy as Copy]];

/** What a copy does to one battle: the log it leaves, or the message it throws. */
function outcome(copy: Copy, doubles: boolean, commands: Commands): { log: string[]; thrown: string | null } {
  const battle = board(doubles);
  let thrown: string | null = null;
  try { copy(battle as SimBattle & Battle, commands); } catch (error) { thrown = (error as Error).message; }
  return { log: battle.log.filter(line => !line.startsWith('|t:|')), thrown };
}

describe('the two chooseOnCopy functions answer alike', () => {
  for (const doubles of [false, true]) {
    const game = doubles ? 'doubles' : 'singles';
    const move = (name: string, aim = ''): string => (doubles ? `move ${name}${aim}, move softboiled` : `move ${name}`);
    const rows: [string, Commands][] = [
      ['both sides choose', [{ side: 'p1', command: move('bodyslam', ' 1') }, { side: 'p2', command: move('curse') }]],
      ['p1 chooses a move it has not', [{ side: 'p1', command: move('thunderbolt', ' 1') }, { side: 'p2', command: move('curse') }]],
      ['p2 chooses a move it has not', [{ side: 'p1', command: move('curse') }, { side: 'p2', command: move('thunderbolt', ' 1') }]],
    ];
    for (const [label, commands] of rows) {
      test(`${game}: ${label}`, () => {
        const [branch, dice] = copies.map(([, copy]) => outcome(copy, doubles, commands));
        expect(branch).toEqual(dice);
        // The rows have teeth: a refusal throws, an accepted pair writes the turn.
        expect(branch.thrown !== null).toBe(label !== 'both sides choose');
        if (branch.thrown === null) expect(branch.log.some(line => line.startsWith('|move|'))).toBe(true);
      });
    }
  }

  test('a refusal without a text throws the same fallback sentence for either side', () => {
    for (const side of ['p1', 'p2'] as const) {
      const stub = { choose: () => false, sides: [{ choice: { error: '' } }, { choice: { error: '' } }] } as unknown as SimBattle & Battle;
      const messages = copies.map(([, copy]) => { try { copy(stub, [{ side, command: 'move 1' }]); return null; } catch (error) { return (error as Error).message; } });
      expect(messages).toEqual(['The simulator rejected this choice.', 'The simulator rejected this choice.']);
    }
  });

  test('the error text of each side comes from that side', () => {
    const stub = { choose: () => false, sides: [{ choice: { error: 'one says no' } }, { choice: { error: 'two says no' } }] } as unknown as SimBattle & Battle;
    for (const [side, text] of [['p1', 'one says no'], ['p2', 'two says no']] as const) {
      const messages = copies.map(([, copy]) => { try { copy(stub, [{ side, command: 'x' }]); return null; } catch (error) { return (error as Error).message; } });
      expect(messages).toEqual([text, text]);
    }
  });
});
