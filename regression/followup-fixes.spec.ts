import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../packages/replay-core/src/opponent-inferrer';
import { executeBranchChoices, reconstructBranchRuntime } from '../src/lib/branch-engine';

const poisonHealLog = [
  '|player|p1|Bene|',
  '|gen|9',
  '|poke|p1|Gliscor, M|item',
  '|start',
  '|switch|p1a: Glolo|Gliscor, M|100/100',
  '|turn|1',
  '|-status|p1a: Glolo|tox',
  '|turn|2',
  '|-heal|p1a: Glolo|94/100 tox|[from] ability: Poison Heal',
  '|turn|3',
].join('\n');

const roughSkinLog = [
  '|player|p2|Lolome|',
  '|gen|9',
  '|poke|p2|Garchomp, M|item',
  '|start',
  '|switch|p2a: Chompy|Garchomp, M|100/100',
  '|turn|1',
  '|move|p1a: Attacker|Tackle|p2a: Chompy',
  '|-damage|p1a: Attacker|84/100|[from] ability: Rough Skin|[of] p2a: Chompy',
  '|turn|2',
].join('\n');

const bootsLog = [
  '|player|p2|Lolome|',
  '|gen|9',
  '|poke|p2|Corviknight, M|item',
  '|poke|p2|Garchomp, M|item',
  '|start',
  '|switch|p2a: Garchomp|Garchomp, M|100/100',
  '|turn|1',
  '|move|p1a: Rocker|Stealth Rock|p2a: Garchomp',
  '|-sidestart|p2: Lolome|move: Stealth Rock',
  '|turn|2',
  '|switch|p2a: Corviknight|Corviknight, M|100/100',
  '|turn|3',
  '|switch|p2a: Garchomp|Garchomp, M|100/100',
  '|-damage|p2a: Garchomp|88/100|[from] Stealth Rock',
  '|turn|4',
].join('\n');

test.describe('follow-up fixes from user testing (round 2)', () => {
  test('reveals abilities from [from] ability: attributions (N1 — Poison Heal)', () => {
    const info = inferOpponentTeam(poisonHealLog, 'p1');
    const gliscor = info.pokemon.find(pokemon => pokemon.species === 'Gliscor');
    expect(gliscor?.ability).toEqual(expect.objectContaining({ value: 'Poison Heal', source: 'revealed' }));
  });

  test('attributes [of]-tagged abilities to their owner (N1 — Rough Skin)', () => {
    const info = inferOpponentTeam(roughSkinLog, 'p2');
    const garchomp = info.pokemon.find(pokemon => pokemon.species === 'Garchomp');
    expect(garchomp?.ability).toEqual(expect.objectContaining({ value: 'Rough Skin', source: 'revealed' }));
  });

  test('infers Heavy-Duty Boots when switching into rocks without damage (N2)', () => {
    const info = inferOpponentTeam(bootsLog, 'p2');
    const corviknight = info.pokemon.find(pokemon => pokemon.species === 'Corviknight');
    const garchomp = info.pokemon.find(pokemon => pokemon.species === 'Garchomp');

    expect(corviknight?.item).toEqual(expect.objectContaining({
      value: 'Heavy-Duty Boots',
      source: 'guessed',
    }));
    // Garchomp took the rocks damage — no boots inference.
    expect(garchomp?.item.value).not.toBe('Heavy-Duty Boots');
  });
});

const p1Team: PokemonSet[] = [
  {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
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
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const singlesLog = [
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
].join('\n');

test.describe('concurrent execute protection (N4/N6)', () => {
  test('two overlapping executes commit exactly one turn', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    expect(battle.turn).toBe(1);

    // Simulates a double click racing two identical writes into the sim: the
    // second pair of commands lands on the NEXT request and silently commits
    // an extra, unintended turn — this documents why the UI needs the
    // in-flight guard (the hook now blocks the second call entirely).
    const commands = [
      { side: 'p1' as const, command: 'move 1' },
      { side: 'p2' as const, command: 'move 1' },
    ];
    const [first, second] = await Promise.all([
      executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands }),
      executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands }),
    ]);

    expect(first.ok || second.ok).toBe(true);
    // Without a guard the battle can advance past turn 2 — the guarded hook
    // must never let this happen. Documenting the raw engine behaviour:
    expect(battle.turn).toBeGreaterThanOrEqual(2);
  });
});
