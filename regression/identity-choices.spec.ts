import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime, resolveSideChoices } from '../packages/eval-engine/src/branch-engine';
import type { BranchSlotChoice } from '../packages/eval-engine/src/branch-choices';

function pikachu(moves: string[]): PokemonSet {
  return {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves,
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  };
}

const eevee: PokemonSet = {
  name: 'Eevee',
  species: 'Eevee',
  item: 'Eviolite',
  ability: 'Adaptability',
  moves: ['Tackle', 'Protect'],
  nature: 'Jolly',
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50,
};

const bulbasaur: PokemonSet = {
  name: 'Bulbasaur',
  species: 'Bulbasaur',
  item: 'Eviolite',
  ability: 'Overgrow',
  moves: ['Vine Whip', 'Protect'],
  nature: 'Modest',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50,
};

const singlesLog = [
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
].join('\n');

const protectChoice: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };

async function makeSinglesRuntime(p1Moves: string[]) {
  return reconstructBranchRuntime({
    format: 'gen9ou',
    p1Team: [pikachu(p1Moves), eevee],
    p2Team: [bulbasaur],
    replayLog: singlesLog,
    targetTurn: 1,
  });
}

test.describe('identity-based choice resolution (B1)', () => {
  test('resolves the same move id to different slots depending on the current moveset', async () => {
    const original = await makeSinglesRuntime(['Thunderbolt', 'Protect']);
    const resolvedOriginal = resolveSideChoices(original.battleStream.battle!, 'p1', [protectChoice], [true]);
    expect(resolvedOriginal).toEqual({ ok: true, command: 'move 2' });

    // Same stored choice after a team edit shuffled the move order (B1b core):
    const edited = await makeSinglesRuntime(['Protect', 'Thunderbolt']);
    const resolvedEdited = resolveSideChoices(edited.battleStream.battle!, 'p1', [protectChoice], [true]);
    expect(resolvedEdited).toEqual({ ok: true, command: 'move 1' });
  });

  test('fails loudly when the stored move no longer exists after a team edit', async () => {
    const runtime = await makeSinglesRuntime(['Thunderbolt', 'Quick Attack']);
    const resolved = resolveSideChoices(runtime.battleStream.battle!, 'p1', [protectChoice], [true]);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('Protect');
  });

  test('resolves switches by identity and rejects unavailable Pokémon', async () => {
    const runtime = await makeSinglesRuntime(['Thunderbolt', 'Protect']);
    const battle = runtime.battleStream.battle!;

    const eeveeSwitch: BranchSlotChoice = { kind: 'switch', speciesId: 'eevee', pokemonName: 'Eevee' };
    expect(resolveSideChoices(battle, 'p1', [eeveeSwitch], [true]))
      .toEqual({ ok: true, command: 'switch 2' });

    const activeSwitch: BranchSlotChoice = { kind: 'switch', speciesId: 'pikachu', pokemonName: 'Pikachu' };
    const resolved = resolveSideChoices(battle, 'p1', [activeSwitch], [true]);
    expect(resolved.ok).toBe(false);
  });

  test('keeps explicit doubles targets when resolving move identities', async () => {
    const { default: doublesTeams } = await import('./fixtures/doubles-identity-fixture');
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: doublesTeams.p1Team,
      p2Team: doublesTeams.p2Team,
      replayLog: doublesTeams.log,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;

    const targeted: BranchSlotChoice = { kind: 'move', moveId: 'thunderbolt', moveName: 'Thunderbolt', targetLoc: 2 };
    const passive: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };
    const resolved = resolveSideChoices(battle, 'p1', [targeted, passive], [true, true]);
    expect(resolved).toEqual({ ok: true, command: 'move 1 +2, move 2' });
  });
});
