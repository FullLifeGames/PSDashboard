import { test, expect } from '@playwright/test';
import { createBranchState, reconstructBranchRuntime } from '../src/lib/branch-engine';
import { getReplayBringCount } from '../src/lib/replay-format';
import type { PokemonSet } from '@pkmn/sim';

function mon(name: string, move: string): PokemonSet {
  return {
    name,
    species: name,
    item: '',
    ability: '',
    moves: [move, 'Protect'],
    nature: 'Serious',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  };
}

const p1Team: PokemonSet[] = [
  mon('Pikachu', 'Thunderbolt'), mon('Eevee', 'Tackle'), mon('Raichu', 'Thunderbolt'),
  mon('Jolteon', 'Thunderbolt'), mon('Flareon', 'Ember'), mon('Vaporeon', 'Water Gun'),
];
const p2Team: PokemonSet[] = [
  mon('Bulbasaur', 'Vine Whip'), mon('Charmander', 'Ember'), mon('Squirtle', 'Water Gun'),
  mon('Ivysaur', 'Vine Whip'), mon('Charmeleon', 'Ember'), mon('Wartortle', 'Water Gun'),
];

const vgcLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|teampreview',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
].join('\n');

test.describe('bring-limited team preview (VGC 4 of 6)', () => {
  test('getReplayBringCount answers from the rule table and the format-id heuristic', () => {
    // Regulations newer than the bundled sim resolve via the heuristic.
    expect(getReplayBringCount({ formatid: 'gen9vgc2026regi' })).toBe(4);
    // A regulation the Dex knows answers from its own rule table.
    expect(getReplayBringCount({ formatid: 'gen9vgc2025regi' })).toBe(4);
    expect(getReplayBringCount({ formatid: 'gen9battlestadiumsinglesregi' })).toBe(3);
    // Bring-all formats have no limit.
    expect(getReplayBringCount({ formatid: 'gen9ou' })).toBe(null);
    expect(getReplayBringCount({ formatid: 'gen9doublesou' })).toBe(null);
  });

  test('bringOnly fields exactly the brought four with the chosen leads first', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      onLogLines: lines => logLines.push(...lines),
      leadOverride: { p1: ['Raichu', 'Jolteon'], p2: ['Squirtle', 'Ivysaur'] },
      bringOnly: {
        p1: ['Raichu', 'Jolteon', 'Pikachu', 'Eevee'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(4);
    expect(battle.sides[1].pokemon).toHaveLength(4);
    expect(battle.sides[0].pokemon.map(pokemon => pokemon.species.name)).not.toContain('Flareon');

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });
    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Raichu', 'Jolteon']);
    expect(state.p2ActiveSlots.map(active => active?.species)).toEqual(['Squirtle', 'Ivysaur']);
    // The bench holds ONLY the rest of the brought four.
    expect(state.p1SwitchesBySlot[0].map(option => option.species).sort()).toEqual(['Eevee', 'Pikachu']);
  });

  test('a bring list the team cannot satisfy fails open to the whole team', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Raichu', 'Jolteon', 'Pikachu', 'Mewtwo'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(6);
    expect(battle.sides[1].pokemon).toHaveLength(4);
  });
});
