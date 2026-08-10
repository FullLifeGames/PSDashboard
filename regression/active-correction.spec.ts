import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import {
  reconstructBranchRuntime,
  executeBranchChoices,
  correctActivesFromProtocol,
} from '../src/lib/branch-engine';

function makeSet(name: string, species: string, moves: string[]): PokemonSet {
  return {
    name,
    species,
    item: '',
    ability: 'No Ability',
    moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    gender: '',
  };
}

const p1Team = [
  makeSet('Pika', 'Pikachu', ['Thunderbolt', 'Protect']),
  makeSet('Eve', 'Eevee', ['Tackle', 'Protect']),
  makeSet('Squirt', 'Squirtle', ['Water Gun', 'Protect']),
];

const p2Team = [makeSet('Bulba', 'Bulbasaur', ['Vine Whip', 'Protect'])];

const singlesLog = [
  '|switch|p1a: Pika|Pikachu, L50|100/100',
  '|switch|p2a: Bulba|Bulbasaur, L50|100/100',
  '|turn|1',
].join('\n');

test.describe('correctActivesFromProtocol', () => {
  // When the sim resolves a random switch (e.g. a Whirlwind drag) differently
  // than the replay protocol, the correction must keep side.pokemon aligned
  // with side.active — otherwise the sim's next real switch swaps stale
  // positions, duplicating one team member and erasing another (the
  // "Cannot switch to Metagross" bug from gen9draft-2298735122).
  test('keeps side.pokemon aligned when repointing an active slot', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const side = runtime.battleStream.battle!.sides[0];

    correctActivesFromProtocol(runtime.battleStream.battle!, [
      '|drag|p1a: Eve|Eevee, L50|100/100',
    ]);

    expect(side.active[0]?.name).toBe('Eve');
    expect(side.pokemon[0]?.name).toBe('Eve');
    expect(side.pokemon.map(pokemon => pokemon.name).sort()).toEqual(['Eve', 'Pika', 'Squirt']);
    side.pokemon.forEach((pokemon, index) => expect(pokemon.position).toBe(index));
  });

  test('a repointed Pokémon enters fresh — no inherited choice lock (GPL T38)', async () => {
    // A diverged sim can keep a mon on the field locked into a Choice move
    // while the REAL game switched it out and back in. The correction that
    // forces it active must clear the lock trio — the real entry was fresh.
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    const side = battle.sides[0];
    const eve = side.pokemon.find(pokemon => pokemon.name === 'Eve')!;
    // Manufacture the diverged state: benched Eevee carrying a stale lock.
    eve.volatiles['choicelock'] = { id: 'choicelock', move: 'tackle' } as never;
    eve.moveSlots.forEach(slot => { slot.disabled = true; });

    correctActivesFromProtocol(battle, ['|switch|p1a: Eve|Eevee, L50|100/100']);

    expect(side.active[0]?.name).toBe('Eve');
    expect('choicelock' in eve.volatiles).toBe(false);
    expect(eve.lastMove).toBeNull();
    eve.moveSlots.forEach(slot => expect(slot.disabled).toBe(false));
  });

  test('the request regenerates after a correction — options follow the corrected active', async () => {
    // Stale requests after a repoint made legalChoices offer the WRONG mon's
    // moves (gen9doublesou-2660802611: Grimmsnarl's screens offered while
    // Indeedee was the corrected active; Imprison-disabled flags missing).
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;

    correctActivesFromProtocol(battle, ['|drag|p1a: Eve|Eevee, L50|100/100']);

    const request = battle.sides[0].activeRequest as {
      active?: ({ moves?: { move: string }[] } | null)[];
    } | null;
    expect(request?.active?.[0]?.moves?.map(move => move.move)).toEqual(['Tackle', 'Protect']);
  });

  test('a real switch after a correction neither duplicates nor loses team members', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    const side = battle.sides[0];

    correctActivesFromProtocol(battle, ['|drag|p1a: Eve|Eevee, L50|100/100']);

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'switch 3' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(result.ok).toBe(true);

    const names = side.pokemon.map(pokemon => pokemon.name);
    expect(new Set(names).size).toBe(3);
    expect(names.sort()).toEqual(['Eve', 'Pika', 'Squirt']);
    expect(side.pokemon.filter(pokemon => pokemon.isActive)).toHaveLength(1);
  });
});
