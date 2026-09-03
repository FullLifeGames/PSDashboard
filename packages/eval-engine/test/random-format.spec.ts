import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime, executeBranchChoices } from '../src/branch-engine';

// Random Battle branching (B2): the runtime must start the real random format
// with the reconstructed teams and execute turns. The browser-only `global`
// shim lives in branch-engine.ts; this covers the format wiring end-to-end.

const p1Team: PokemonSet[] = [
  {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 84,
  },
];

const p2Team: PokemonSet[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    item: 'Eviolite',
    ability: 'Overgrow',
    moves: ['Vine Whip', 'Protect'],
    nature: 'Modest',
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 84,
  },
];

const randomBattleLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|singles',
  '|gen|9',
  '|tier|[Gen 9] Random Battle',
  '|',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L84|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L84|100/100',
  '|turn|1',
].join('\n');

test.describe('random battle branching (B2)', () => {
  test('starts a gen9randombattle branch with reconstructed teams and executes turns', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9randombattle',
      p1Team,
      p2Team,
      replayLog: randomBattleLog,
      targetTurn: 1,
    });

    const battle = runtime.battleStream.battle;
    expect(battle).toBeTruthy();
    expect(battle!.turn).toBe(1);
    // The supplied teams must be used instead of generated random teams.
    expect(battle!.sides[0].active[0]?.name).toBe('Pikachu');
    expect(battle!.sides[1].active[0]?.name).toBe('Bulbasaur');

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move 1' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(result.ok).toBe(true);

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && battle!.turn < 2) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(battle!.turn).toBe(2);
  });
});
